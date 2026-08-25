'use strict';
// Sub-bisect inside the MeshAndBsp blob: original bytes everywhere, with exactly
// ONE mesh/BSP chunk (by index) taken from the variant.
//   node chunksplice.js <orig> <variant> <out> <chunkIndex>
// Patches the blob's declared size and the archive's hashTableOffset.
const fs = require('node:fs');
const path = require('node:path');
const { walk } = require('../lib/container');

function info(buf) {
  let header = null, blobStart = null;
  for (const ev of walk(buf)) {
    if (ev.kind === 'header') header = ev.header;
    if (ev.kind === 'rawBlob') { blobStart = ev.fileOffset; break; }
  }
  const size = buf.readUInt32LE(blobStart - 4);
  const chunks = [];
  let p = blobStart;
  const end = blobStart + size;
  while (p + 6 <= end) {
    const id = buf.readUInt16LE(p), len = buf.readUInt32LE(p + 2);
    chunks.push({ i: chunks.length, id: '0x' + id.toString(16), off: p, total: 6 + len });
    p += 6 + len;
  }
  if (p !== end) throw new Error(`chunk walk ended at ${p}, declared end ${end}`);
  return { header, blobStart, size, chunks };
}

const [O, V, OUT, IDX] = process.argv.slice(2);
const idx = Number(IDX);
const bo = fs.readFileSync(O), bv = fs.readFileSync(V);
const io = info(bo), iv = info(bv);
if (io.chunks.length !== iv.chunks.length) throw new Error('chunk count differs');
if (io.chunks[idx].id !== iv.chunks[idx].id) throw new Error('chunk id differs at ' + idx);

const newBlob = Buffer.concat(io.chunks.map((c, i) => {
  const src = i === idx ? { b: bv, c: iv.chunks[i] } : { b: bo, c };
  return src.b.subarray(src.c.off, src.c.off + src.c.total);
}));
const preBlob = Buffer.from(bo.subarray(0, io.blobStart));           // ... + bspVersion + size
const postBlob = Buffer.from(bo.subarray(io.blobStart + io.size, io.header.hashTableOffset));
const ht = bo.subarray(io.header.hashTableOffset);
const out = Buffer.concat([preBlob, newBlob, postBlob, ht]);
out.writeUInt32LE(newBlob.length, io.blobStart - 4);                  // blob declared size
out.writeUInt32LE(preBlob.length + newBlob.length + postBlob.length, io.header.entryStart - 4); // hashTableOffset
fs.writeFileSync(OUT, out);

// verify the result parses and ends exactly at its hash table
const chk = info(out);
let events = 0, exact = false;
for (const ev of walk(out)) { if (ev.kind === 'eos') { exact = ev.exact; break; } events++; }
console.log(JSON.stringify({
  out: path.basename(OUT), chunk: idx, id: io.chunks[idx].id,
  origChunkLen: io.chunks[idx].total, variantChunkLen: iv.chunks[idx].total,
  blobSize: chk.size, fileSize: out.length, events, exactEnd: exact,
  chunkChanged: !bo.subarray(io.chunks[idx].off, io.chunks[idx].off + io.chunks[idx].total)
    .equals(bv.subarray(iv.chunks[idx].off, iv.chunks[idx].off + iv.chunks[idx].total)),
}));

