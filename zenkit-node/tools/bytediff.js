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
// The COVERAGE line is the point of this tool: it accounts for every byte of the
// file (text header + every event span + the trailing region) and reports the
// gap. Only with `gap 0` does "the rest is identical" mean anything — a diff
// that silently skips a region can call a broken file clean.
const fs = require('node:fs');
const { walk, readHeader } = require('../lib/container');
const { walkAscii } = require('../lib/container-ascii');

// The BinSafe stream ends at the hash table; the ASCII stream ends at EOF and
// has no table. `streamEnd` is the one number the two formats disagree on.
function walkerFor(buf) {
  const format = readHeader(buf).lines[3];
  if (format === 'BIN_SAFE') return walk;
  if (format === 'ASCII') return walkAscii;
  throw new Error(`no walker for a ${format} archive`);
}
const streamEnd = (hdr, buf) =>
  hdr.header.hashTableOffset !== undefined ? hdr.header.hashTableOffset : buf.length;

const A = fs.readFileSync(process.argv[2]);
const B = fs.readFileSync(process.argv[3]);
const ga = walkerFor(A)(A), gb = walkerFor(B)(B);
const ha = ga.next().value, hb = gb.next().value;

function events(gen) { const out = []; for (const ev of gen) out.push(ev); return out; }
const ea = events(ga), eb = events(gb);
console.log('events', ea.length, eb.length);
// compute byte spans per event: [fileOffset, nextEvent.fileOffset)
function spans(evs, buf, hdr) {
  const s = [];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    let end = i + 1 < evs.length ? evs[i + 1].fileOffset : streamEnd(hdr, buf);
    // Both walkers report the blob's declared size, so nothing here has to know
    // where the length prefix sits in either format.
    if (e.kind === 'rawBlob') { end = e.fileOffset + e.size; }
    if (e.kind === 'eos') break;
    s.push({ e, start: e.fileOffset, end });
  }
  return s;
}
const sa = spans(ea, A, ha), sb = spans(eb, B, hb);

// Whole-file accounting, so "everything else is identical" is a measured claim.
const headA = A.subarray(0, ha.header.entryStart), headB = B.subarray(0, hb.header.entryStart);
const tailA = A.subarray(streamEnd(ha, A)), tailB = B.subarray(streamEnd(hb, B));
const coveredA = headA.length + sa.reduce((n, s) => n + (s.end - s.start), 0) + tailA.length;
console.log(`text header identical: ${headA.equals(headB)} (${headA.length} vs ${headB.length} B)`);
console.log(`trailer identical:     ${tailA.equals(tailB)} (${tailA.length} vs ${tailB.length} B)`);
console.log(`COVERAGE: ${coveredA} of ${A.length} bytes accounted for, gap ${A.length - coveredA}`);

const byKey = new Map();
let nd = 0, blobPair = null, identicalBytes = 0;
for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
  const x = sa[i], y = sb[i];
  if (x.e.kind !== y.e.kind || x.e.entryName !== y.e.entryName) { console.log('ALIGN BREAK at', i, x.e, y.e); break; }
  if (x.e.kind === 'rawBlob') {
    blobPair = [x, y];
    // Counted here too, so `identical event bytes` covers the whole stream; the
    // blob's own chunk-level diff is reported separately below.
    if (A.subarray(x.start, x.end).equals(B.subarray(y.start, y.end))) identicalBytes += x.end - x.start;
    continue;
  }
  const ba = A.subarray(x.start, x.end), bb = B.subarray(y.start, y.end);
  // skip the 5-byte name-index prefix for entries (0x12 idx u32) â€” indices are equal anyway
  if (ba.equals(bb)) { identicalBytes += ba.length; } else {
    nd++;
    const cls = x.e.path.length ? x.e.path[x.e.path.length - 1].split(':')[1] : '<root>';
    const k = `${x.e.kind} ${cls} ${x.e.entryName} ${x.e.entryType}`;
    const rec = byKey.get(k) || { n: 0, sizeDelta: 0, ex: [] };
    rec.n++; rec.sizeDelta += bb.length - ba.length;
    if (rec.ex.length < 2) rec.ex.push({ offA: x.start, offB: y.start, a: x.e.payloadSummary, b: y.e.payloadSummary, la: ba.length, lb: bb.length });
    byKey.set(k, rec);
  }
}
console.log('identical event bytes:', identicalBytes);
console.log('differing events:', nd, 'classes:', byKey.size);
for (const [k, v] of [...byKey].sort((p, q) => q[1].n - p[1].n)) console.log(` ${v.n}\tdelta ${v.sizeDelta}\t${k}\n\t${JSON.stringify(v.ex)}`);

// MeshAndBsp blob chunk table
function chunks(buf, start, size) {
  const out = []; let p = start; const end = start + size;
  while (p + 6 <= end) {
    const id = buf.readUInt16LE(p), len = buf.readUInt32LE(p + 2);
    out.push({ id: '0x' + id.toString(16), off: p, len });
    p += 6 + len;
    if (id === 0xb060 || id === 0xc0ff /* END markers */ ) { /* continue: bsp follows mesh */ }
  }
  return { out, p, end };
}
if (blobPair) {
  const [x, y] = blobPair;
  const sizeA = x.e.size, sizeB = y.e.size;
  console.log('blob sizes', sizeA, sizeB, 'delta', sizeB - sizeA);
  const ca = chunks(A, x.start, sizeA), cb = chunks(B, y.start, sizeB);
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

