'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');

// The same authored-to-temp world the mesh-extraction tests use: it backs no
// fidelity claim and carries no golden dump, so it is free to grow the VOBs
// this needs. Its second root tree exists only for these tests — the first is
// the one the golden fixture shares.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-vobindex-'));
const FIXTURE = path.join(dir, 'vob-index.g2.zen');
zenkit._authorFixtureWorld(FIXTURE, 'binsafe', 'g2', 'mesh-extraction');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const handle = () => zenkit.loadWorld(FIXTURE, 'g2');
const index = () => zenkit.vobIndex(handle());
const dump = () => zenkit.normalizeWorld(handle());

const f32 = (buf) => Array.from(new Float32Array(buf));
const i32 = (buf) => Array.from(new Int32Array(buf));
const u32 = (buf) => Array.from(new Uint32Array(buf));

// The index addresses a VOB by parent + position among its siblings rather than
// by a path string, because building 23,288 path strings is most of what makes
// the dump expensive. Rebuilding one path is the consumer's job, and this is it.
function paths(ix) {
  const parent = i32(ix.parent);
  const childIndex = u32(ix.childIndex);
  const out = [];
  for (let i = 0; i < ix.count; i++) {
    out.push(parent[i] < 0 ? String(childIndex[i]) : `${out[parent[i]]}/${childIndex[i]}`);
  }
  return out;
}

test('vobIndex enumerates exactly the VOBs normalizeWorld does, in order', () => {
  // Not a weaker view of the world — the same one. If the two disagree about
  // what exists or in what order, a pick in the viewport selects the wrong VOB
  // and an op edits the wrong VOB, with nothing reporting a problem.
  const ix = index();
  const vobs = dump().vobs;

  assert.strictEqual(ix.count, vobs.length);
  assert.deepStrictEqual(paths(ix), vobs.map((v) => v.path));
});

test('vobIndex reports position and rotation in ZenGin space', () => {
  const ix = index();
  const vobs = dump().vobs;

  assert.deepStrictEqual(f32(ix.positions), vobs.flatMap((v) => v.position));
  assert.deepStrictEqual(f32(ix.rotations), vobs.flatMap((v) => v.rotation));

  // Unconverted, like every other buffer the binding emits: the single
  // ZenGin->Three.js conversion lives in zen-world/coords (level-editor.md §7).
  const spot = vobs.findIndex((v) => v.name === 'VOB_INDEX_A');
  assert.deepStrictEqual(f32(ix.positions).slice(spot * 3, spot * 3 + 3), [110, 1, 120]);
});

test('vobIndex interns the repeated strings instead of repeating them', () => {
  // Visual names repeat heavily — 23,288 retail VOBs name 444 distinct visuals —
  // and the dictionary is what keeps the index cheap enough to sit on the
  // world-open path at all.
  const ix = index();
  const vobs = dump().vobs;

  const visualOf = (i) => ix.visuals[u32(ix.visualIndex)[i]];
  const typeOf = (i) => ix.visualTypes[u32(ix.visualTypeIndex)[i]];
  const classOf = (i) => ix.classes[u32(ix.classIndex)[i]];
  const nameOf = (i) => ix.names[u32(ix.nameIndex)[i]];

  for (let i = 0; i < ix.count; i++) {
    // `?? ''` is the one deliberate difference: the dump says null for a VOB
    // with no visual object, a dictionary column has no null, and "no visual"
    // and "a visual with an empty name" mean the same thing to a renderer.
    assert.strictEqual(visualOf(i), vobs[i].visual ?? '', `visual of vob ${i}`);
    assert.strictEqual(typeOf(i), vobs[i].visualType ?? 'UNKNOWN', `type of vob ${i}`);
    assert.strictEqual(classOf(i), vobs[i].class);
    assert.strictEqual(nameOf(i), vobs[i].name);
  }

  // A VOB authored with no visual at all. It is written and read back as a
  // visual with an empty name rather than as an absent one, so the round trip
  // never actually produces the null the dump has a branch for — which is why
  // the loop above maps it rather than asserting it never happens.
  const none = vobs.findIndex((v) => v.name === 'VOB_INDEX_NOVISUAL');
  assert.strictEqual(visualOf(none), '');
  assert.strictEqual(typeOf(none), 'UNKNOWN');

  // VOB_INDEX_ROOT and VOB_INDEX_A carry the same visual, so it must appear in
  // the dictionary once and be reached through one shared index.
  const root = vobs.findIndex((v) => v.name === 'VOB_INDEX_ROOT');
  const a = vobs.findIndex((v) => v.name === 'VOB_INDEX_A');
  const visualIndex = u32(ix.visualIndex);
  assert.strictEqual(visualOf(root), 'EX_CRATE.3DS');
  assert.strictEqual(visualIndex[root], visualIndex[a]);
  assert.strictEqual(ix.visuals.filter((v) => v === 'EX_CRATE.3DS').length, 1);

  // A VOB with no visual is the empty string, never null and never absent.
  const noVisual = vobs.findIndex((v) => v.visual === '');
  assert.strictEqual(visualOf(noVisual), '');
});

test('vobIndex packs the flags that decide whether a VOB is drawn', () => {
  const ix = index();
  const vobs = dump().vobs;
  const flags = u32(ix.flags);

  for (let i = 0; i < ix.count; i++) {
    assert.deepStrictEqual(
      {
        showVisual: (flags[i] & 1) !== 0,
        vobStatic: (flags[i] & 2) !== 0,
        ambient: (flags[i] & 4) !== 0,
        cdStatic: (flags[i] & 8) !== 0,
        cdDynamic: (flags[i] & 16) !== 0,
        physicsEnabled: (flags[i] & 32) !== 0,
      },
      {
        showVisual: vobs[i].flags.showVisual,
        vobStatic: vobs[i].flags.vobStatic,
        ambient: vobs[i].flags.ambient,
        cdStatic: vobs[i].flags.cdStatic,
        cdDynamic: vobs[i].flags.cdDynamic,
        physicsEnabled: vobs[i].flags.physicsEnabled,
      },
      `vob ${i} (${vobs[i].name})`,
    );
  }

  // The fixture's VOB_INDEX_ROOT is the one that is shown and static, so the
  // two bits that matter most to a viewport are not both-zero everywhere.
  const root = vobs.findIndex((v) => v.name === 'VOB_INDEX_ROOT');
  assert.strictEqual(flags[root] & 3, 3);
});

test('vobIndex is the index, not the dump', () => {
  // It deliberately carries no per-class properties and no container section:
  // those are what make normalizeWorld a 933 ms diagnostic instrument, and the
  // renderer never holds the world anyway (level-editor.md §7).
  const ix = index();

  assert.strictEqual(ix.props, undefined);
  assert.strictEqual(ix.container, undefined);
  assert.strictEqual(ix.mesh, undefined);
  assert.strictEqual(ix.waynet, undefined);
});

test('vobIndex buffer lengths agree with the declared count', () => {
  const ix = index();

  assert.strictEqual(ix.positions.byteLength, ix.count * 3 * 4);
  assert.strictEqual(ix.rotations.byteLength, ix.count * 9 * 4);
  assert.strictEqual(ix.parent.byteLength, ix.count * 4);
  assert.strictEqual(ix.childIndex.byteLength, ix.count * 4);
  assert.strictEqual(ix.flags.byteLength, ix.count * 4);
  for (const key of ['classIndex', 'nameIndex', 'visualIndex', 'visualTypeIndex']) {
    assert.strictEqual(ix[key].byteLength, ix.count * 4, key);
    // Transferable to the renderer as-is (level-editor.md §7).
    assert.ok(ix[key] instanceof ArrayBuffer, key);
  }
});
