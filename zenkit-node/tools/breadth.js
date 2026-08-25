'use strict';
// Re-save every retail G2 world with the patched writer and report, per world:
// blob byte-identity, the event-level byte diff summary, determinism, and the
// classifier verdict (struct dump + container section).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const zk = require('..');
const { walk } = require('../lib/container');
const { classifyDumps } = require('../lib/classify');

// A developer-local Gothic install; never committed, never written to.
const WORLDS = process.env.ZENKIT_G2_WORLDS
  || 'C:/Program Files (x86)/Steam/steamapps/common/Gothic II/_work/Data/Worlds';
const targets = process.argv.slice(2);

function blobOf(file) {
  const b = fs.readFileSync(file);
  for (const e of walk(b)) if (e.kind === 'rawBlob') {
    const n = b.readUInt32LE(e.fileOffset - 4);
    return b.subarray(e.fileOffset, e.fileOffset + n);
  }
  return null;
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function eventDiff(A, B) {
  const ba = fs.readFileSync(A), bb = fs.readFileSync(B);
  const ga = walk(ba), gb = walk(bb);
  const ha = ga.next().value, hb = gb.next().value;
  const ea = [], eb = [];
  for (const e of ga) ea.push(e);
  for (const e of gb) eb.push(e);
  const spans = (evs, buf, hdr) => evs.slice(0, -1).map((e, i) => {
    let end = i + 1 < evs.length ? evs[i + 1].fileOffset : hdr.header.hashTableOffset;
    if (e.kind === 'rawBlob') end = e.fileOffset + buf.readUInt32LE(e.fileOffset - 4);
    return { e, start: e.fileOffset, end };
  });
  const sa = spans(ea, ba, ha), sb = spans(eb, bb, hb);
  if (sa.length !== sb.length) return { aligned: false, events: [sa.length, sb.length] };
  const classes = new Map();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i].e.kind === 'rawBlob') continue;
    if (!ba.subarray(sa[i].start, sa[i].end).equals(bb.subarray(sb[i].start, sb[i].end))) {
      const p = sa[i].e.path, cls = p.length ? p[p.length - 1].split(':')[1] : '<root>';
      const k = `${cls} ${sa[i].e.entryName} ${sa[i].e.entryType}`;
      classes.set(k, (classes.get(k) || 0) + 1);
    }
  }
  return { aligned: true, events: sa.length, differing: [...classes].map(([k, n]) => `${n}Ã— ${k}`) };
}

// The four BinSafe worlds. The other 24 .zen files under Worlds/ are
// zCArchiverGeneric/ASCII — a writer path with no fidelity work yet (see the
// acceptance record §9), so they are deliberately not listed here.
const PATHS = {
  NewWorld: `${WORLDS}/NewWorld/NewWorld.zen`,
  OldWorld: `${WORLDS}/OldWorld/OldWorld.zen`,
  AddonWorld: `${WORLDS}/Addon/AddonWorld.zen`,
  DragonIsland: `${WORLDS}/NewWorld/DragonIsland.zen`,
};
for (const name of targets) {
  const orig = PATHS[name];
  const src = fs.existsSync(orig + '.original-backup') ? orig + '.original-backup' : orig;
  const out1 = path.join(os.tmpdir(), `${name}.re1.zen`);
  const out2 = path.join(os.tmpdir(), `${name}.re2.zen`);
  console.log(`\n===== ${name}  (${fs.statSync(src).size} B)`);
  const h = zk.loadWorld(src, 'g2');
  zk.saveWorld(h, out1);
  zk.saveWorld(h, out2);
  const bo = blobOf(src), b1 = blobOf(out1);
  console.log(`  blob: ${bo.length} vs ${b1.length}  IDENTICAL: ${bo.equals(b1)}`);
  console.log(`  deterministic: ${sha(fs.readFileSync(out1)) === sha(fs.readFileSync(out2))}`);
  const d = eventDiff(src, out1);
  console.log(`  events: ${d.events}  differing: ${d.differing && d.differing.length ? d.differing.join(', ') : 'none'}`);
  const res = classifyDumps(zk.normalizeWorld(h), zk.normalizeWorld(zk.loadWorld(out1, 'g2')));
  console.log(`  classifier: ${res.classification}  findings: ${res.findings.length}`);
  for (const f of res.findings.slice(0, 8)) console.log(`    - [${f.classification}] ${f.path}: ${f.detail}`);
  fs.rmSync(out1, { force: true }); fs.rmSync(out2, { force: true });
}

