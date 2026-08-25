'use strict';

// BinSafe entry-stream walker and the `container` section of `normalizeWorld`
// dumps (docs/plans/level-editor-phase-0.md §5, "clean diff / broken engine").
//
// ZenKit's reader is positional + type-checked while ZenGin's is name- and
// version-addressed, so anything the parsed structs ignore — hash-table
// physical order, raw BOOL words, RAW payload bits, object frame versions,
// entry names, the MeshAndBsp chunk internals — is invisible to the struct
// dump by construction. This module computes those facts from the archive
// BYTES. Pure JS; no native code involved.

const { createHash } = require('node:crypto');

const TYPE = {
  1: 'STRING', 2: 'INTEGER', 3: 'FLOAT', 4: 'BYTE', 5: 'WORD', 6: 'BOOL',
  7: 'VEC3', 8: 'COLOR', 9: 'RAW', 0x10: 'RAW_FLOAT', 0x11: 'ENUM', 0x12: 'HASH',
};

const FIXED_SIZE = { 2: 4, 3: 4, 4: 1, 5: 2, 6: 4, 7: 12, 8: 4, 0x11: 4, 0x12: 4 };

function sha256(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return `sha256:${hash.digest('hex')}`;
}

function readHeader(buf) {
  // text header: lines until "END"
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
  const bsVersion = buf.readUInt32LE(pos);
  const objectCount = buf.readUInt32LE(pos + 4);
  const hashTableOffset = buf.readUInt32LE(pos + 8);
  return { lines, entryStart: pos + 12, bsVersion, objectCount, hashTableOffset };
}

// `entries` is indexed by insertionIndex (how entries reference names);
// `physical` is the insertionIndex sequence in file order (ZenGin writes
// bucket/hash order, ZenKit insertion order — same keys, different bytes).
function readHashTable(buf, off) {
  const count = buf.readUInt32LE(off);
  let p = off + 4;
  const entries = [];
  const physical = [];
  for (let i = 0; i < count; i++) {
    const keyLength = buf.readUInt16LE(p);
    const insertionIndex = buf.readUInt16LE(p + 2);
    const hash = buf.readUInt32LE(p + 4);
    const key = buf.toString('latin1', p + 8, p + 8 + keyLength);
    p += 8 + keyLength;
    entries[insertionIndex] = { key, hash, keyLength };
    physical.push(insertionIndex);
  }
  return { count, entries, physical, end: p };
}

function* walk(buf) {
  const h = readHeader(buf);
  const ht = readHashTable(buf, h.hashTableOffset);
  let pos = h.entryStart;
  const limit = h.hashTableOffset;
  let depth = 0;
  const stack = [];
  yield { kind: 'header', header: h, hashTable: ht };
  while (pos < limit) {
    const start = pos;
    const b = buf.readUInt8(pos); pos += 1;
    if (b === 0x12) {
      const idx = buf.readUInt32LE(pos); pos += 4;
      const t = buf.readUInt8(pos); pos += 1;
      const name = ht.entries[idx] ? ht.entries[idx].key : `<bad#${idx}>`;
      let size, summary, payloadOffset;
      switch (t) {
        case 1: case 9: case 0x10: {
          size = buf.readUInt16LE(pos); pos += 2;
          payloadOffset = pos;
          const raw = buf.subarray(pos, pos + size);
          summary = t === 1 ? JSON.stringify(raw.toString('latin1')) : `len=${size}`;
          pos += size;
          break;
        }
        case 2: summary = String(buf.readInt32LE(pos)); break;
        case 3: summary = String(buf.readFloatLE(pos)); break;
        case 4: summary = String(buf.readUInt8(pos)); break;
        case 5: summary = String(buf.readUInt16LE(pos)); break;
        case 6: summary = String(buf.readUInt32LE(pos)); break;
        case 7: summary = `${buf.readFloatLE(pos)},${buf.readFloatLE(pos + 4)},${buf.readFloatLE(pos + 8)}`; break;
        case 8: summary = `#${buf.readUInt32LE(pos).toString(16)}`; break;
        case 0x11: summary = String(buf.readUInt32LE(pos)); break;
        case 0x12: summary = String(buf.readUInt32LE(pos)); break;
        default: throw new Error(`unknown entry type 0x${t.toString(16)} at ${start}`);
      }
      if (payloadOffset === undefined) {
        payloadOffset = pos;
        size = FIXED_SIZE[t];
        pos += size;
      }
      yield { kind: 'entry', fileOffset: start, entryName: name, entryType: TYPE[t] || t,
        payloadSummary: summary, payloadOffset, payloadLength: size, objectDepth: depth, path: stack.slice() };
    } else if (b === 0x01) {
      const len = buf.readUInt16LE(pos); pos += 2;
      const s = buf.toString('latin1', pos, pos + len); pos += len;
      if (s === '[]') {
        const closed = stack.pop();
        depth -= 1;
        yield { kind: 'objectEnd', fileOffset: start, entryName: '[]', entryType: 'STRING',
          payloadSummary: '[]', objectDepth: depth, closed, path: stack.slice() };
        if (depth < 0) throw new Error(`unbalanced object end at ${start}`);
      } else if (s.startsWith('[') && s.endsWith(']')) {
        const parts = s.slice(1, -1).split(' ');
        const frame = { name: parts[0], cls: parts[1], version: parts[2], index: parts[3] };
        yield { kind: 'objectBegin', fileOffset: start, entryName: parts[0], entryType: 'STRING',
          payloadSummary: s, objectDepth: depth, path: stack.slice(), frame };
        stack.push(`${parts[0]}:${parts[1]}#${parts[3]}`);
        depth += 1;
        if (parts[0] === 'MeshAndBsp') {
          // Raw embedded mesh+BSP blob, not part of the entry stream.
          const bspVersion = buf.readUInt32LE(pos);
          const size = buf.readUInt32LE(pos + 4);
          const blobStart = pos + 8;
          pos = blobStart + size;
          yield { kind: 'rawBlob', fileOffset: blobStart, entryName: 'MeshAndBsp',
            entryType: 'RAWBLOB', payloadSummary: `bspVersion=${bspVersion} size=${size}`,
            bspVersion, size, objectDepth: depth, path: stack.slice() };
        }
      } else {
        throw new Error(`unrecognized STRING frame ${JSON.stringify(s)} at ${start}`);
      }
    } else {
      throw new Error(`unexpected leading byte 0x${b.toString(16)} at ${start} (depth ${depth})`);
    }
  }
  yield { kind: 'eos', fileOffset: pos, objectDepth: depth, exact: pos === limit };
}

// Chunk table of the MeshAndBsp blob: `uint16 id, uint32 length, payload`
// throughout (mesh 0xB0xx then BSP 0xC0xx). Bytes past the last whole chunk
// header are kept verbatim as `trailing` (the original writer emits one).
function meshAndBspTable(buf, blob) {
  const end = blob.fileOffset + blob.size;
  let p = blob.fileOffset;
  const chunks = [];
  while (end - p >= 6) {
    const id = buf.readUInt16LE(p);
    const length = buf.readUInt32LE(p + 2);
    const payloadEnd = Math.min(p + 6 + length, end);
    chunks.push({ id: `0x${id.toString(16).padStart(4, '0')}`, length, sha256: sha256(buf.subarray(p + 6, payloadEnd)) });
    p = payloadEnd;
  }
  return { bspVersion: blob.bspVersion, size: blob.size, chunks, trailing: buf.toString('hex', p, end) };
}

// `%` frames (MeshAndBsp, VobTree, WayNet, EndMarker) are distinguished by
// name; every other frame by its full class chain as written.
function frameKey(frame) {
  return frame.cls === '%' ? frame.name : frame.cls;
}

function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

function digestAll(hashes) {
  return sortKeys(Object.fromEntries([...hashes].map(([k, h]) => [k, `sha256:${h.digest('hex')}`])));
}

function feed(hashes, key, ...parts) {
  let h = hashes.get(key);
  if (!h) hashes.set(key, (h = createHash('sha256')));
  for (const part of parts) h.update(part);
}

// Header lines verbatim; only the `date`/`user` VALUES are split off as benign
// writer stamps — the presence and position of those lines is a container fact
// (ZenGin omits them in nested archive headers).
function headerSection(headerLines) {
  const lines = [];
  const stamps = { date: '', user: '' };
  for (const line of headerLines) {
    const m = /^(date|user) ?(.*)$/.exec(line);
    if (m) stamps[m[1]] = m[2];
    lines.push(m ? m[1] : line);
  }
  return { lines, ...stamps };
}

// Only the four BinSafe worlds in a retail G2 install have an entry stream this
// module can walk; the other 24 .zen files are zCArchiverGeneric/ASCII, whose
// container facts are a different (unbuilt) instrument. Saying so in the dump is
// the point: an archive the walker cannot read must report reduced COVERAGE, not
// a section that happens to match on both sides.
function containerFromBuffer(buf) {
  const raw = readHeader(buf);
  const archiver = raw.lines[2];
  const format = raw.lines[3];
  if (format !== 'BIN_SAFE') {
    return { archiver, format, covered: false, header: headerSection(raw.lines) };
  }

  const it = walk(buf);
  const { header, hashTable } = it.next().value;
  const { lines, ...stamps } = headerSection(header.lines);

  const keys = [];
  for (let i = 0; i < hashTable.entries.length; i++) {
    const e = hashTable.entries[i];
    if (e) keys.push({ key: e.key, index: i, hash: e.hash });
  }

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
    hashTable: { count: hashTable.count, keys, physicalOrder: sha256(hashTable.physical.join(',')) },
    frames: { total: objects, sequenceHash: `sha256:${frameHash.digest('hex')}`, classes: sortKeys(classes) },
    schemas: sortKeys(schemas),
    stream: {
      binSafeVersion: header.bsVersion,
      declaredObjectCount: header.objectCount,
      events,
      objects,
      maxDepth,
      endsAtHashTable: eos.exact,
    },
    payloads: { raw: digestAll(rawHashes), bool: digestAll(boolHashes) },
    meshAndBsp,
  };
}

module.exports = { walk, readHeader, readHashTable, containerFromBuffer, TYPE };
