'use strict';
// BinSafe entry-stream walker.
const fs = require('node:fs');

const TYPE = {
  1: 'STRING', 2: 'INTEGER', 3: 'FLOAT', 4: 'BYTE', 5: 'WORD', 6: 'BOOL',
  7: 'VEC3', 8: 'COLOR', 9: 'RAW', 0x10: 'RAW_FLOAT', 0x11: 'ENUM', 0x12: 'HASH',
};

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

function readHashTable(buf, off) {
  const count = buf.readUInt32LE(off);
  let p = off + 4;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const keyLength = buf.readUInt16LE(p);
    const insertionIndex = buf.readUInt16LE(p + 2);
    const hash = buf.readUInt32LE(p + 4);
    const key = buf.toString('latin1', p + 8, p + 8 + keyLength);
    p += 8 + keyLength;
    entries[insertionIndex] = { key, hash, keyLength };
  }
  return { count, entries, end: p };
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
      let size, summary;
      switch (t) {
        case 1: case 9: case 0x10: {
          size = buf.readUInt16LE(pos); pos += 2;
          const raw = buf.subarray(pos, pos + size);
          summary = t === 1 ? JSON.stringify(raw.toString('latin1')) : `len=${size}`;
          pos += size;
          break;
        }
        case 2: summary = String(buf.readInt32LE(pos)); pos += 4; break;
        case 3: summary = String(buf.readFloatLE(pos)); pos += 4; break;
        case 4: summary = String(buf.readUInt8(pos)); pos += 1; break;
        case 5: summary = String(buf.readUInt16LE(pos)); pos += 2; break;
        case 6: summary = String(buf.readUInt32LE(pos)); pos += 4; break;
        case 7: summary = `${buf.readFloatLE(pos)},${buf.readFloatLE(pos + 4)},${buf.readFloatLE(pos + 8)}`; pos += 12; break;
        case 8: summary = `#${buf.readUInt32LE(pos).toString(16)}`; pos += 4; break;
        case 0x11: summary = String(buf.readUInt32LE(pos)); pos += 4; break;
        case 0x12: summary = String(buf.readUInt32LE(pos)); pos += 4; break;
        default: throw new Error(`unknown entry type 0x${t.toString(16)} at ${start}`);
      }
      yield { kind: 'entry', fileOffset: start, entryName: name, entryType: TYPE[t] || t,
        payloadSummary: summary, objectDepth: depth, path: stack.slice() };
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
            objectDepth: depth, path: stack.slice() };
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

module.exports = { walk, readHeader, readHashTable, TYPE };

if (require.main === module) {
  const file = process.argv[2];
  const buf = fs.readFileSync(file);
  let n = 0, objs = 0, maxDepth = 0, last = null, hdr = null;
  try {
    for (const ev of walk(buf)) {
      if (ev.kind === 'header') { hdr = ev; continue; }
      if (ev.kind === 'eos') { last = ev; break; }
      n++;
      if (ev.kind === 'objectBegin') objs++;
      if (ev.objectDepth > maxDepth) maxDepth = ev.objectDepth;
      last = ev;
    }
  } catch (e) {
    console.log('FAILED:', e.message, 'after', n, 'events; last=', JSON.stringify(last));
    process.exit(1);
  }
  console.log(JSON.stringify({
    file, entryStart: hdr.header.entryStart, bsVersion: hdr.header.bsVersion,
    objectCount: hdr.header.objectCount, hashTableOffset: hdr.header.hashTableOffset,
    hashTableCount: hdr.hashTable.count, hashTableEnd: hdr.hashTable.end, fileSize: buf.length,
    events: n, objectBegins: objs, maxDepth, endDepth: last.objectDepth, exactEnd: last.exact,
  }, null, 2));
}
