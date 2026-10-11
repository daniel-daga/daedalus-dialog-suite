'use strict';

// BINARY object-frame walker and the `container` section for it (#227;
// docs/plans/level-editor.md §14.3 3.1). Pure JS; no native code involved.
//
// The third format, and the one the instrument could not look inside, so every
// BINARY row of a fidelity run read `struct-only` — which the harness's own
// rule says is never a pass.
//
// **What the format gives, and what it does not.** A BinSafe entry carries a
// name index, a type tag and, for the variable kinds, a length; an ASCII entry
// carries its name and type as text. A BINARY entry carries *nothing*:
// `WriteArchiveBinary::write_int` writes four bytes and drops the name on the
// floor. So there is no entry stream to walk, and no byte in the file tells an
// entry apart from the first four bytes of a child object's size. Only object
// frames are recoverable, and only by finding them.
//
// **So the walk has to prove itself.** A frame is `uint32 size, uint16 version,
// uint32 index, string0 objectName, string0 className`, and a scan for anything
// shaped like one over a real world also finds string entry payloads — a
// material name followed by the right bytes looks exactly like a frame. Three
// facts the archive states about itself rule those out:
//
//   1. `objects N` in the header is the writer's own count of the frames it
//      handed an index to, so the recovered frames must agree with it exactly.
//   2. Frames nest: any two are nested or disjoint, never overlapping.
//   3. The outermost frame spans from the first byte of the stream to EOF.
//
// A walk that fails any of them reports `covered: false` with the reason, which
// is the honest answer — a section built on an unproved walk would compare
// equal to another unproved walk and read as a fidelity pass.

const { createHash } = require('node:crypto');
const { sha256, headerSection, frameKey, sortKeys, digestAll, feed } = require('./container.js');

/** A frame header is 4 + 2 + 4 bytes plus two NUL-terminated strings. */
const FRAME_FIXED = 10;

/** `oCWorld:zCWorld`, `%`, `§` (a reference) or empty (the world's own section
 *  wrappers, which `write_object_begin` treats as class-less). Anything else is
 *  a run of payload bytes that happened to end in a NUL. */
const CLASS_NAME = /^(|%|\xa7|[A-Za-z][A-Za-z0-9_]*(:[A-Za-z][A-Za-z0-9_]*)*)$/;
/** Non-empty, and that is the load-bearing part: every `write_object` overload
 *  passes a name — `"%"` when the caller gave none — so a frame with an empty
 *  one is a run of payload bytes rather than anything the writer emits. */
const OBJECT_NAME = /^[\x20-\x7e\xa7]{1,255}$/;

/**
 * The text header, the `objects N` field, and where the frames begin.
 *
 * `write_header` emits the six common lines, then `objects ` followed by a
 * nine-character right-padded count, then `END\n` **and a blank line** — the
 * `write_line("END\n")` that produces two newlines rather than one. The padding
 * and the blank line are container facts: a writer that dropped either would
 * move every byte after it, and nothing in the struct dump would notice.
 */
function readBinaryHeader(buf) {
  let pos = 0;
  const lines = [];
  for (;;) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) throw new Error('no END in header');
    const line = buf.toString('latin1', pos, nl).replace(/\r$/, '');
    lines.push(line);
    pos = nl + 1;
    if (line === 'END') break;
  }

  const objectsFieldOffset = pos;
  const fieldEnd = buf.indexOf(0x0a, pos);
  if (fieldEnd < 0) throw new Error('no objects field');
  const objectsField = buf.toString('latin1', pos, fieldEnd).replace(/\r$/, '');
  if (!objectsField.startsWith('objects ')) throw new Error('objects header field missing');
  pos = fieldEnd + 1;

  const secondEnd = buf.indexOf(0x0a, pos);
  if (secondEnd < 0 || buf.toString('latin1', pos, secondEnd).replace(/\r$/, '') !== 'END') {
    throw new Error('second END missing');
  }
  pos = secondEnd + 1;
  if (buf[pos] === 0x0a) pos += 1;

  return {
    lines,
    objectsField,
    objectsFieldOffset,
    declaredObjects: Number.parseInt(objectsField.slice('objects '.length).trim(), 10),
    entryStart: pos,
  };
}

function readCString(buf, at, limit) {
  const z = buf.indexOf(0, at);
  if (z < 0 || z >= limit) return null;
  return { value: buf.toString('latin1', at, z), next: z + 1 };
}

/** A frame at `at`, or null for bytes that are not one. */
function frameAt(buf, at, limit) {
  if (at + FRAME_FIXED > limit) return null;
  const size = buf.readUInt32LE(at);
  if (size < FRAME_FIXED + 2 || at + size > limit) return null;

  const name = readCString(buf, at + FRAME_FIXED, limit);
  if (name === null || !OBJECT_NAME.test(name.value)) return null;
  const cls = readCString(buf, name.next, limit);
  if (cls === null || !CLASS_NAME.test(cls.value)) return null;
  if (cls.next - at > size) return null;

  return {
    at,
    size,
    end: at + size,
    version: buf.readUInt16LE(at + 4),
    index: buf.readUInt32LE(at + 6),
    name: name.value,
    cls: cls.value,
    bodyStart: cls.next,
  };
}

/**
 * The `MeshAndBsp` payload: `uint32 bspVersion, uint32 size, blob`, written
 * straight to the stream by `World::save` rather than through the archiver.
 *
 * It is skipped rather than scanned, exactly as the BinSafe walker skips it —
 * the blob holds a whole nested archive with an object counter of its own, so
 * frames found inside would be frames the outer `objects N` never counted, and
 * the count check would refuse a walk that was right.
 */
function blobAt(buf, frame, limit) {
  if (frame.name !== 'MeshAndBsp' || frame.bodyStart + 8 > limit) return null;
  const bspVersion = buf.readUInt32LE(frame.bodyStart);
  const size = buf.readUInt32LE(frame.bodyStart + 4);
  const start = frame.bodyStart + 8;
  if (start + size > frame.end) return null;
  return { fileOffset: start, size, bspVersion };
}

/** Whether a frame is one the writer handed an index to — which is what
 *  `objects N` counts. `write_object_begin` treats an empty class name and `%`
 *  alike as class-less, and a reference (`§`) points back at an index already
 *  handed out rather than taking a new one. */
function isCounted(frame) {
  return frame.cls !== '' && frame.cls !== '%' && frame.cls !== '\xa7';
}

/**
 * The index a frame must carry to be the real thing, given how many have been
 * counted so far.
 *
 * This is the check that separates a frame from a run of bytes that merely
 * looks like one, and it is the writer's own arithmetic rather than a guess:
 * `write_object_begin` hands out `_m_index++` in file order, so the counted
 * frames carry 0, 1, 2 … with no gaps; a class-less frame is written `0`; and a
 * reference names an index already given out, so it is below the counter. Four
 * bytes of float data have to agree with all of that to survive.
 */
function indexFits(frame, counter) {
  if (isCounted(frame)) return frame.index === counter;
  if (frame.cls === '\xa7') return frame.index < counter;
  return frame.index === 0;
}

/**
 * Every frame in the stream, in file order, or a reason there is no answer.
 *
 * A single left-to-right pass does it: at each offset either a frame starts —
 * in which case the scan continues after its header, and after its blob if it
 * has one — or the byte belongs to some object's unnamed payload and the scan
 * moves on one byte. Nesting comes out of the sizes and needs no second pass.
 *
 * What keeps a lucky run of bytes out is `indexFits` above, applied as the scan
 * goes rather than afterwards: a candidate whose index does not continue the
 * writer's sequence is not a frame, and skipping it there also stops it from
 * opening a bogus interval that would swallow the real frames after it.
 */
function recoverFrames(buf, start, limit) {
  if (frameAt(buf, start, limit) === null) return { error: 'the stream does not begin with an object frame' };

  const frames = [];
  const open = [];
  let pos = start;
  let counter = 0;
  while (pos < limit) {
    while (open.length > 0 && open[open.length - 1].end === pos) {
      frames.push({ kind: 'end', at: pos, frame: open.pop() });
    }
    if (open.length > 0 && open[open.length - 1].end < pos) {
      return { error: `an object frame ends at ${open[open.length - 1].end}, inside the bytes of another` };
    }

    const outer = open.length > 0 ? open[open.length - 1].end : limit;
    const frame = frameAt(buf, pos, outer);
    if (frame === null || !indexFits(frame, counter)) { pos += 1; continue; }
    if (isCounted(frame)) counter += 1;

    frames.push({ kind: 'begin', at: pos, frame });
    open.push(frame);
    pos = frame.bodyStart;

    const blob = blobAt(buf, frame, outer);
    if (blob !== null) {
      frames.push({ kind: 'blob', at: blob.fileOffset, frame, blob });
      pos = blob.fileOffset + blob.size;
    }
  }
  while (open.length > 0 && open[open.length - 1].end === pos) {
    frames.push({ kind: 'end', at: pos, frame: open.pop() });
  }
  if (open.length > 0) return { error: 'an object frame runs past the end of the file' };
  if (frames.length === 0 || frames[0].frame.end !== limit) {
    return { error: 'the outermost object frame does not span the whole stream' };
  }
  return { frames };
}

/** The same event shape `walk` and `walkAscii` yield, so `container-diff` needs
 *  to know nothing about which format it is aligning. There is no `entry` kind:
 *  the bytes between frames are an object's own unnamed payload, and they fall
 *  into the preceding event's span, which is the finest grain this format has. */
function* walkBinary(buf) {
  const header = readBinaryHeader(buf);
  const limit = buf.length;
  yield { kind: 'header', header };

  const recovered = recoverFrames(buf, header.entryStart, limit);
  if (recovered.error) throw new Error(recovered.error);

  const stack = [];
  let depth = 0;
  for (const step of recovered.frames) {
    const { frame } = step;
    if (step.kind === 'begin') {
      yield {
        kind: 'objectBegin',
        fileOffset: step.at,
        entryName: frame.name,
        entryType: 'FRAME',
        payloadSummary: `[${frame.name} ${frame.cls} ${frame.version} ${frame.index}]`,
        objectDepth: depth,
        // The frame itself, not its parent — the other two walkers push after
        // yielding because their `objectBegin` span is the frame header alone,
        // while here it runs to the next event and so holds the object's own
        // unnamed payload. `container-diff` builds its key from the last path
        // element, so pushing first is what makes a changed byte report the
        // object it is in rather than the one it is under.
        path: stack.concat(`${frame.name}:${frame.cls}#${frame.index}`),
        bodyStart: frame.bodyStart,
        frame: { name: frame.name, cls: frame.cls, version: String(frame.version), index: String(frame.index) },
      };
      stack.push(`${frame.name}:${frame.cls}#${frame.index}`);
      depth += 1;
    } else if (step.kind === 'blob') {
      yield {
        kind: 'rawBlob',
        fileOffset: step.blob.fileOffset,
        entryName: 'MeshAndBsp',
        entryType: 'RAWBLOB',
        payloadSummary: `bspVersion=${step.blob.bspVersion} size=${step.blob.size}`,
        bspVersion: step.blob.bspVersion,
        size: step.blob.size,
        objectDepth: depth,
        path: stack.slice(),
      };
    } else {
      stack.pop();
      depth -= 1;
      yield {
        kind: 'objectEnd',
        fileOffset: step.at,
        entryName: '[]',
        entryType: 'FRAME',
        payloadSummary: '[]',
        objectDepth: depth,
        closed: `${frame.name}:${frame.cls}#${frame.index}`,
        path: stack.slice(),
      };
    }
  }
  yield { kind: 'eos', fileOffset: limit, objectDepth: depth, exact: depth === 0 };
}

/**
 * The `container` section, in the shape `containerFromBuffer` returns for the
 * other two formats — minus the two sections this format cannot support.
 *
 * `schemas` is absent and `entryNames` is `false`, said rather than left to be
 * inferred: a reader comparing two BINARY dumps has to be able to tell "these
 * archives agree on every entry name" from "neither archive has entry names".
 * In their place `payloads.objects` digests each frame's own bytes by class,
 * which is the finest grain the format admits and still catches a writer that
 * changed what it puts inside a `zCVobLight`.
 */
function containerFromBinaryBuffer(buf) {
  const header = readBinaryHeader(buf);
  const { lines, ...stamps } = headerSection(header.lines);
  const recovered = recoverFrames(buf, header.entryStart, buf.length);
  const declined = (reason) => ({
    archiver: lines[2],
    format: lines[3],
    covered: false,
    reason,
    header: { lines, date: stamps.date, user: stamps.user },
  });

  if (recovered.error) return declined(recovered.error);

  const frameHash = createHash('sha256');
  const classes = {};
  const payloads = new Map();
  let objects = 0;
  let counted = 0;
  let maxDepth = 0;
  let depth = 0;
  let meshAndBsp = null;

  for (const step of recovered.frames) {
    const { frame } = step;
    if (step.kind === 'blob') {
      // Digested whole rather than chunk by chunk: `meshAndBspTable` reads the
      // mesh's own `uint16 id, uint32 length` table, and inside a BINARY world
      // that region begins with a nested ZenGin archive instead — a different
      // structure, and one this walker deliberately does not go into.
      meshAndBsp = {
        bspVersion: step.blob.bspVersion,
        size: step.blob.size,
        sha256: sha256(buf.subarray(step.blob.fileOffset, step.blob.fileOffset + step.blob.size)),
      };
      continue;
    }
    if (step.kind === 'end') { depth -= 1; continue; }

    objects += 1;
    depth += 1;
    if (depth > maxDepth) maxDepth = depth;
    frameHash.update(`[${frame.name} ${frame.cls} ${frame.version} ${frame.index}]\n`);
    if (isCounted(frame)) counted += 1;

    const key = frameKey({ name: frame.name, cls: frame.cls });
    const c = classes[key] || (classes[key] = { count: 0, versions: {} });
    c.count += 1;
    c.versions[frame.version] = (c.versions[frame.version] || 0) + 1;
    // The frame's own bytes, blob excluded — the blob is digested as its own
    // section and is two orders of magnitude larger than everything around it.
    const bodyEnd = step.kind === 'begin' && frame.name === 'MeshAndBsp' ? frame.bodyStart : frame.end;
    feed(payloads, key, buf.subarray(frame.at, bodyEnd));
  }

  if (counted !== header.declaredObjects) {
    return declined(
      `the header declares ${header.declaredObjects} objects and the stream carries ${counted}`,
    );
  }

  return {
    archiver: lines[2],
    format: lines[3],
    covered: true,
    entryNames: false,
    header: { lines, date: stamps.date, user: stamps.user },
    objectsField: header.objectsField,
    frames: { total: objects, sequenceHash: `sha256:${frameHash.digest('hex')}`, classes: sortKeys(classes) },
    stream: {
      declaredObjectCount: header.declaredObjects,
      events: recovered.frames.length,
      objects,
      maxDepth,
      endsAtEof: true,
    },
    payloads: { objects: digestAll(payloads) },
    meshAndBsp,
  };
}

module.exports = { walkBinary, readBinaryHeader, containerFromBinaryBuffer, recoverFrames };
