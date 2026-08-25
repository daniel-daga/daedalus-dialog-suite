'use strict';
// BinSafe entry-stream walker CLI. The walker itself lives in lib/container.js
// (one implementation, shared with normalizeWorld's `container` section).
const fs = require('node:fs');
const { walk } = require('../lib/container');

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
