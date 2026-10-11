'use strict';
// Single-variable splice: rebuild a BinSafe world from ORIGINAL (O) bytes,
// taking selected byte groups from the re-saved VARIANT (V).
//   node splice.js <O> <V> <out> <take,...>
// take groups: header | blob | vobtree | locked | dataRaw | colorAni | hashtable | all-but-blob
// Requires both files to have an identical event stream (same event count,
// names, kinds) and identical hash-table indexâ†’key mapping â€” verified here.
const fs = require('node:fs');
const path = require('node:path');
const { walk } = require('../lib/container');

const [O, V, OUT, TAKE] = process.argv.slice(2);
const take = new Set(TAKE.split(','));
if (take.has('all-but-blob')) ['header', 'vobtree', 'hashtable'].forEach((t) => take.add(t));
const bo = fs.readFileSync(O), bv = fs.readFileSync(V);

function collect(buf) {
  const g = walk(buf);
  const hdr = g.next().value;
  const evs = [];
  for (const ev of g) evs.push(ev);
  const eos = evs.pop();
  if (!eos.exact) throw new Error('stream does not end at hashTableOffset');
  // spans: [start,end) per event; rawBlob span is the blob bytes; the
  // MeshAndBsp objectBegin span therefore covers frame + bspVersion + size.
  const spans = evs.map((e, i) => {
    let end = i + 1 < evs.length ? evs[i + 1].fileOffset : hdr.header.hashTableOffset;
    if (e.kind === 'rawBlob') end = e.fileOffset + buf.readUInt32LE(e.fileOffset - 4);
    return { e, start: e.fileOffset, end };
  });
  return { hdr, spans };
}
const co = collect(bo), cv = collect(bv);
if (co.spans.length !== cv.spans.length) throw new Error('event count differs');
const ko = co.hdr.hashTable.entries, kv = cv.hdr.hashTable.entries;
for (let i = 0; i < ko.length; i++) {
  if (!ko[i] || !kv[i] || ko[i].key !== kv[i].key || ko[i].hash !== kv[i].hash) throw new Error('hash table index mapping differs at ' + i);
}

function group(s) {
  const e = s.e;
  if (e.kind === 'rawBlob') return 'blob';
  if (e.kind === 'objectBegin' && e.entryName === 'MeshAndBsp') return 'blob';
  const inVobTree = e.path[1] === 'VobTree:%#0' || (e.kind === 'objectBegin' && e.entryName === 'VobTree') || (e.kind === 'objectEnd' && e.closed === 'VobTree:%#0');
  if (inVobTree) {
    if (e.kind === 'entry' && e.entryName === 'locked' && e.entryType === 'BOOL') return 'locked';
    if (e.kind === 'entry' && e.entryName === 'dataRaw' && e.entryType === 'RAW') return 'dataRaw';
    if (e.kind === 'entry' && e.entryName === 'colorAniList') return 'colorAni';
    return 'vobtree-other';
  }
  return 'other';
}
const parts = [];
const stats = {};
// header (text + 12-byte binary header); hashTableOffset patched below
const hdrSrc = take.has('header') ? { b: bv, h: cv.hdr } : { b: bo, h: co.hdr };
parts.push(Buffer.from(hdrSrc.b.subarray(0, hdrSrc.h.header.entryStart)));
for (let i = 0; i < co.spans.length; i++) {
  const so = co.spans[i], sv = cv.spans[i];
  if (so.e.kind !== sv.e.kind || so.e.entryName !== sv.e.entryName) throw new Error('event mismatch at ' + i);
  const g = group(so);
  const fromV = take.has(g) || (take.has('vobtree') && (g === 'locked' || g === 'dataRaw' || g === 'colorAni' || g === 'vobtree-other'));
  const src = fromV ? bv.subarray(sv.start, sv.end) : bo.subarray(so.start, so.end);
  if (fromV && !src.equals(bo.subarray(so.start, so.end))) stats[g] = (stats[g] || 0) + 1;
  parts.push(src);
}
let body = Buffer.concat(parts);
const htSrc = take.has('hashtable') ? bv.subarray(cv.hdr.header.hashTableOffset) : bo.subarray(co.hdr.header.hashTableOffset);
const out = Buffer.concat([body, htSrc]);
// patch hashTableOffset (last 4 bytes of the 12-byte binary header)
const entryStart = hdrSrc.h.header.entryStart;
out.writeUInt32LE(body.length, entryStart - 4);
fs.writeFileSync(OUT, out);
// verify
const chk = collect(out);
console.log(JSON.stringify({ out: path.basename(OUT), take: [...take], size: out.length, events: chk.spans.length, hashTableOffset: chk.hdr.header.hashTableOffset, htCount: chk.hdr.hashTable.count, htEnd: chk.hdr.hashTable.end, eventsTakenFromVThatDiffer: stats }));

