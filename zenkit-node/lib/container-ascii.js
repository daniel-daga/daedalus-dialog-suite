'use strict';

// ASCII (`zCArchiverGeneric`) counterpart of lib/container.js's BinSafe walker,
// and the `container` section of `normalizeWorld` dumps for those archives.
//
// 24 of the 28 .zen files in a retail Gothic II install are ASCII, and the
// ASCII writer has four named defects (docs/engine-acceptance-2026-08-25.md
// §10.2). Until this module existed `containerFromBuffer` answered
// `covered: false` for that format, so the instrument could not fail on the
// very archives it was pointed at: a full fix of A1–A4 would have left the
// suite green and unchanged.
//
// The contract is the BinSafe walker's, event for event, so everything
// downstream — classify.js, the harness, tools/bytediff.js — needs no branch of
// its own. Two facts are the ASCII format's alone and are recorded because
// nothing else can see them:
//
//   - the top-level `objects` line VERBATIM, padding included. ZenGin pads that
//     field to 9 characters and ZenKit to 11 (A4);
//   - the leading-tab indentation, which is `write_indent()` output and
//     therefore container state, not whitespace.
//
// A RAW payload is kept as the HEX TEXT the file holds rather than the bytes it
// decodes to. That text is what ZenGin reads, and A1 is a corruption of the
// text: decoding first would hash a defect into agreement.

const { createHash } = require('node:crypto');
const {
  headerSection, frameKey, sortKeys, digestAll, feed, meshAndBspTable,
} = require('./container.js');

// The ASCII type token → the same names lib/container.js's TYPE table uses, so
// a schema reads the same in either format. The map is a bijection: the token
// is the container fact (A3 is `rawFloat:` written where ZenGin writes `raw:`)
// and nothing may collapse two tokens into one name.
const TYPE = {
  string: 'STRING', int: 'INTEGER', float: 'FLOAT', byte: 'BYTE', word: 'WORD',
  bool: 'BOOL', vec3: 'VEC3', vec2: 'VEC2', color: 'COLOR', enum: 'ENUM',
  raw: 'RAW', rawFloat: 'RAW_FLOAT',
};

function readLine(buf, pos) {
  let nl = buf.indexOf(0x0a, pos);
  if (nl < 0) nl = buf.length;
  let textEnd = nl;
  if (textEnd > pos && buf[textEnd - 1] === 0x0d) textEnd -= 1;
  return { text: buf.toString('latin1', pos, textEnd), next: nl + 1 };
}

// Two `END`s: the archive header block, then the `objects <count>` line, then a
// second `END` and a blank line. `entryStart` is past the blank run so that a
// whole-file byte accounting (tools/bytediff.js) has no gap in front of the
// first event.
function readAsciiHeader(buf) {
  let pos = 0;
  const lines = [];
  for (;;) {
    const line = readLine(buf, pos);
    lines.push(line.text);
    pos = line.next;
    if (line.text === 'END') break;
    if (pos >= buf.length) throw new Error('no END in ASCII header');
  }
  const objects = readLine(buf, pos);
  pos = objects.next;
  if (!objects.text.startsWith('objects ')) throw new Error('no `objects` line in ASCII header');
  const end = readLine(buf, pos);
  pos = end.next;
  if (end.text !== 'END') throw new Error('no second END in ASCII header');

  let leadingBlanks = 0;
  for (;;) {
    const line = readLine(buf, pos);
    if (line.text.trim() !== '') break;
    if (pos >= buf.length) break;
    leadingBlanks += 1;
    pos = line.next;
  }
  return {
    lines,
    objectsLine: objects.text,
    objectCount: Number.parseInt(objects.text.slice('objects '.length), 10),
    leadingBlanks,
    entryStart: pos,
    streamEnd: buf.length,
  };
}

// Same event vocabulary as lib/container.js's `walk`: header, objectBegin,
// objectEnd, entry, rawBlob, eos.
function* walkAscii(buf) {
  const h = readAsciiHeader(buf);
  let pos = h.entryStart;
  let depth = 0;
  let blankLines = 0;
  let indentExact = true;
  const stack = [];
  yield { kind: 'header', header: h };

  while (pos < buf.length) {
    const start = pos;
    const line = readLine(buf, start);
    pos = line.next;
    const body = line.text.replace(/^[\t ]+/, '');
    const indent = line.text.length - body.length;
    if (body === '') { blankLines += 1; continue; }
    if (indent !== (body === '[]' ? depth - 1 : depth)) indentExact = false;

    if (body === '[]') {
      const closed = stack.pop();
      depth -= 1;
      if (depth < 0) throw new Error(`unbalanced object end at ${start}`);
      yield { kind: 'objectEnd', fileOffset: start, entryName: '[]', entryType: 'STRING',
        payloadSummary: '[]', objectDepth: depth, indent, closed, path: stack.slice() };
    } else if (body.startsWith('[') && body.endsWith(']')) {
      const parts = body.slice(1, -1).split(' ');
      if (parts.length !== 4) throw new Error(`unrecognized object frame ${JSON.stringify(body)} at ${start}`);
      const frame = { name: parts[0], cls: parts[1], version: parts[2], index: parts[3] };
      yield { kind: 'objectBegin', fileOffset: start, entryName: parts[0], entryType: 'STRING',
        payloadSummary: body, objectDepth: depth, indent, path: stack.slice(), frame };
      stack.push(`${parts[0]}:${parts[1]}#${parts[3]}`);
      depth += 1;
      if (parts[0] === 'MeshAndBsp') {
        // Raw binary embedded in an "ASCII" archive, written straight to the
        // stream by World::save. It contains 0x0a bytes and byte runs that read
        // as framing, so it is consumed by its declared length or the walker
        // desynchronises inside the mesh and never recovers.
        const bspVersion = buf.readUInt32LE(pos);
        const size = buf.readUInt32LE(pos + 4);
        const blobStart = pos + 8;
        pos = blobStart + size;
        yield { kind: 'rawBlob', fileOffset: blobStart, entryName: 'MeshAndBsp',
          entryType: 'RAWBLOB', payloadSummary: `bspVersion=${bspVersion} size=${size}`,
          bspVersion, size, objectDepth: depth, indent, path: stack.slice() };
      }
    } else {
      // `name=type:value`. The name ends at the FIRST `=` and the type at the
      // first `:` after it; a value may hold both (`contains=string:ITMI_GOLD:25`).
      const eq = body.indexOf('=');
      if (eq < 0) throw new Error(`unrecognized line ${JSON.stringify(body)} at ${start}`);
      const rest = body.slice(eq + 1);
      const colon = rest.indexOf(':');
      if (colon < 0) throw new Error(`entry with no type token ${JSON.stringify(body)} at ${start}`);
      const token = rest.slice(0, colon);
      const value = rest.slice(colon + 1);
      const entryType = TYPE[token] || token.toUpperCase();
      yield {
        kind: 'entry',
        fileOffset: start,
        entryName: body.slice(0, eq),
        entryType,
        payloadSummary: entryType === 'RAW' || entryType === 'RAW_FLOAT'
          ? `len=${value.length}` : JSON.stringify(value),
        payloadOffset: start + indent + eq + 1 + colon + 1,
        payloadLength: value.length,
        objectDepth: depth,
        indent,
        path: stack.slice(),
      };
    }
  }
  yield { kind: 'eos', fileOffset: Math.min(pos, buf.length), objectDepth: depth,
    exact: depth === 0, blankLines, indentExact };
}

// The BinSafe `containerFromBuffer` body, over ASCII events. Sections that have
// no ASCII counterpart (the hash table, the BinSafe stream version) are absent
// rather than null; `objects` is present here and nowhere else.
function containerFromAsciiBuffer(buf) {
  const it = walkAscii(buf);
  const { header } = it.next().value;
  const { lines, ...stamps } = headerSection(header.lines);

  const frameHash = createHash('sha256');
  const classes = {};
  const schemas = {};
  const rawHashes = new Map();
  const boolHashes = new Map();
  const objectStack = [];
  let events = 0;
  let objects = 0;
  let maxDepth = 0;
  let meshAndBsp = null;
  let eos = null;
  const lengthPrefix = Buffer.alloc(4);

  for (const ev of it) {
    if (ev.kind === 'eos') { eos = ev; break; }
    events += 1;
    if (ev.objectDepth > maxDepth) maxDepth = ev.objectDepth;
    if (ev.kind === 'objectBegin') {
      objects += 1;
      frameHash.update(`${ev.payloadSummary}\n`);
      const key = frameKey(ev.frame);
      const c = classes[key] || (classes[key] = { count: 0, versions: {} });
      c.count += 1;
      c.versions[ev.frame.version] = (c.versions[ev.frame.version] || 0) + 1;
      objectStack.push({ key, entries: [], reference: ev.frame.cls === '§' });
    } else if (ev.kind === 'objectEnd') {
      const obj = objectStack.pop();
      if (obj.reference) continue; // `§` reference frames carry no entries
      const s = schemas[obj.key] || (schemas[obj.key] = { entries: obj.entries, objects: 0, deviating: 0 });
      s.objects += 1;
      if (JSON.stringify(s.entries) !== JSON.stringify(obj.entries)) s.deviating += 1;
    } else if (ev.kind === 'entry') {
      const obj = objectStack[objectStack.length - 1];
      const key = obj ? obj.key : '<root>';
      if (obj) obj.entries.push([ev.entryName, ev.entryType]);
      const payload = buf.subarray(ev.payloadOffset, ev.payloadOffset + ev.payloadLength);
      if (ev.entryType === 'RAW' || ev.entryType === 'RAW_FLOAT') {
        lengthPrefix.writeUInt32LE(ev.payloadLength);
        feed(rawHashes, `${key}/${ev.entryName}`, lengthPrefix, payload);
      } else if (ev.entryType === 'BOOL') {
        feed(boolHashes, `${key}/${ev.entryName}`, payload);
      }
    } else if (ev.kind === 'rawBlob') {
      meshAndBsp = meshAndBspTable(buf, ev);
    }
  }

  return {
    archiver: lines[2],
    format: lines[3],
    covered: true,
    header: { lines, date: stamps.date, user: stamps.user },
    // Verbatim, padding included: ZenGin pads to 9 characters, ZenKit to 11 (A4).
    objects: { line: header.objectsLine, declared: header.objectCount },
    frames: { total: objects, sequenceHash: `sha256:${frameHash.digest('hex')}`, classes: sortKeys(classes) },
    schemas: sortKeys(schemas),
    stream: {
      declaredObjectCount: header.objectCount,
      events,
      objects,
      maxDepth,
      leadingBlankLines: header.leadingBlanks,
      blankLines: eos.blankLines,
      indentExact: eos.indentExact,
      balanced: eos.exact,
      endsAtEof: eos.fileOffset === buf.length,
    },
    payloads: { raw: digestAll(rawHashes), bool: digestAll(boolHashes) },
    meshAndBsp,
  };
}

module.exports = { walkAscii, readAsciiHeader, containerFromAsciiBuffer, TYPE };
