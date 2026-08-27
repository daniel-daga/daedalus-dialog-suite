'use strict';
// Event-aligned byte diff of two worlds: for every entry/object event, compare
// the raw bytes of the event (name index excluded, payload included). Also diffs
// the MeshAndBsp blob by its internal chunk table.
//
// BinSafe and ASCII both, dispatched on the archive header — the ASCII writer's
// four defects (../docs/engine-acceptance-2026-08-25.md §10.2) live in an entry
// stream `walk()` cannot parse, and a tool that could only read the format that
// already round-trips is a tool that can only report good news.
//
// The diff itself is `../lib/container-diff.js`, shared with the harness
// (`../scripts/zen-roundtrip.js`), so the two cannot again disagree about which
// formats exist. This file is the printer.
//
// The COVERAGE line is the point of this tool: it accounts for every byte of the
// file (text header + every event span + the trailing region) and reports the
// gap. Only with `gap 0` does "the rest is identical" mean anything — a diff
// that silently skips a region can call a broken file clean.
const fs = require('node:fs');
const { readHeader } = require('../lib/container');
const { byteDiff, walkerFor } = require('../lib/container-diff');

const A = fs.readFileSync(process.argv[2]);
const B = fs.readFileSync(process.argv[3]);
// BINARY has no walker and is refused rather than guessed at.
for (const buf of [A, B]) {
  if (!walkerFor(buf)) throw new Error(`no walker for a ${readHeader(buf).lines[3]} archive`);
}

const d = byteDiff(A, B, false);
console.log('events', d.events[0], d.events[1]);
console.log(`text header identical: ${d.textHeaderIdentical}`);
console.log(`trailer identical:     ${d.trailerIdentical}`);
console.log(`COVERAGE: ${d.coverage.accounted} of ${d.coverage.total} bytes accounted for, gap ${d.coverage.gap}`);
if (!d.aligned) console.log('ALIGN BREAK at', d.alignBreak.at, d.alignBreak.original, d.alignBreak.resaved);
console.log('identical event bytes:', d.identicalEventBytes);
console.log('differing events:', d.differing.reduce((n, x) => n + x.count, 0), 'classes:', d.differing.length);
for (const v of [...d.differing].sort((p, q) => q.count - p.count)) {
  console.log(` ${v.count}\tdelta ${v.sizeDelta}\t${v.key}\n\t${JSON.stringify(v.examples)}`);
}

// MeshAndBsp blob chunk table
function chunks(buf, start, size) {
  const out = []; let p = start; const end = start + size;
  while (p + 6 <= end) {
    const id = buf.readUInt16LE(p), len = buf.readUInt32LE(p + 2);
    out.push({ id: '0x' + id.toString(16), off: p, len });
    p += 6 + len;
  }
  return { out, p, end };
}
if (d.blob) {
  const { original: x, resaved: y } = d.blob;
  console.log('blob sizes', x.size, y.size, 'delta', y.size - x.size);
  const ca = chunks(A, x.start, x.size), cb = chunks(B, y.start, y.size);
  console.log('chunk walk end A', ca.p, 'declared end', ca.end, 'trail', ca.end - ca.p, '| B', cb.p, cb.end, 'trail', cb.end - cb.p);
  console.log('chunk counts', ca.out.length, cb.out.length);
  for (let i = 0; i < Math.max(ca.out.length, cb.out.length); i++) {
    const p = ca.out[i], q = cb.out[i];
    const same = p && q && p.id === q.id && p.len === q.len && A.subarray(p.off, p.off + 6 + p.len).equals(B.subarray(q.off, q.off + 6 + q.len));
    if (!same) console.log('  chunk', i, JSON.stringify(p), JSON.stringify(q));
  }
  if (ca.end - ca.p > 0) console.log('  A trailing bytes:', A.subarray(ca.p, ca.end));
  if (cb.end - cb.p > 0) console.log('  B trailing bytes:', B.subarray(cb.p, cb.end));
}
