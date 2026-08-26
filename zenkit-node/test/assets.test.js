'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');

// The asset fixtures (src/fixture.cc AuthorFixtureAssets) are authored into a
// temp directory rather than checked in, for the same reason the
// mesh-extraction world is: they back no fidelity claim, so they are free to
// change alongside the extractor they exercise. No game assets are involved,
// so this runs in CI.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-assets-'));
const ASSETS = path.join(root, 'assets');
zenkit._authorFixtureAssets(ASSETS);

// A second mount source, to observe what mount order does. Loose files are
// enough: resolution never opens the file it resolves to.
const OVERLAY = path.join(root, 'overlay');
fs.mkdirSync(OVERLAY);
fs.writeFileSync(path.join(OVERLAY, 'EX_LIT.TEX'), 'overlay');
fs.writeFileSync(path.join(OVERLAY, 'EX_MOD_ONLY.MRM'), 'overlay');

test.after(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // A live VFS keeps every mounted file memory-mapped and Windows refuses to
    // delete one until the handle is collected, which is not deterministic
    // here. Leaving a temp directory behind is not worth failing a run over.
  }
});

const vfs = (...paths) => zenkit.openVfs(paths.length === 0 ? [ASSETS] : paths);
const f32 = (buf) => Array.from(new Float32Array(buf));
const u32 = (buf) => Array.from(new Uint32Array(buf));

// --- openVfs -------------------------------------------------------------

test('openVfs mounts a host directory into one namespace', () => {
  const handle = vfs();
  assert.strictEqual(zenkit.vfsResolve(handle, 'EX_CRATE.3DS'), 'EX_CRATE.MRM');
  assert.strictEqual(zenkit.vfsResolve(handle, 'EX_MOD_ONLY.3DS'), null);
});

test('openVfs mounts several sources, later ones winning', () => {
  // The load order ZenGin itself uses: a mod directory listed after the retail
  // VDFs overrides them. Both sources are visible; the overlay's own file is
  // reachable and the retail-side name still resolves.
  const handle = vfs(ASSETS, OVERLAY);
  assert.strictEqual(zenkit.vfsResolve(handle, 'EX_MOD_ONLY.3DS'), 'EX_MOD_ONLY.MRM');
  assert.strictEqual(zenkit.vfsResolve(handle, 'EX_CRATE.3DS'), 'EX_CRATE.MRM');
});

test('openVfs rejects a path that does not exist', () => {
  assert.throws(() => zenkit.openVfs([path.join(root, 'no-such-directory')]), /cannot stat VFS path/);
});

test('openVfs rejects a bad overwrite mode and a non-array argument', () => {
  assert.throws(() => zenkit.openVfs(ASSETS), /expects an array of paths/);
  assert.throws(() => zenkit.openVfs([ASSETS], { overwrite: 'sometimes' }), /must be 'all'/);
});

test('the asset functions reject anything that is not a VFS handle', () => {
  for (const fn of ['vfsResolve', 'extractVisual', 'decodeTexture']) {
    assert.throws(() => zenkit[fn]({}, 'EX_CRATE.3DS'), /expected a VFS handle/, fn);
  }
  assert.throws(() => zenkit.vfsResolve(vfs(), 42), /name must be a string/);
});

// --- name mapping --------------------------------------------------------

test('vfsResolve maps a VOB source asset name to the compiled one', () => {
  const handle = vfs();

  // Spelled out rather than probed, and each mapping verified against the
  // retail install before it was written down.
  assert.deepStrictEqual(
    [
      ['EX_CRATE.3DS', zenkit.vfsResolve(handle, 'EX_CRATE.3DS')],
      ['EX_PLATE.3DS', zenkit.vfsResolve(handle, 'EX_PLATE.3DS')],
      ['EX_HERO.ASC', zenkit.vfsResolve(handle, 'EX_HERO.ASC')],
      ['EX_HERO.MDS', zenkit.vfsResolve(handle, 'EX_HERO.MDS')],
      ['EX_GOBBO.ASC', zenkit.vfsResolve(handle, 'EX_GOBBO.ASC')],
      ['EX_BLOB.MMS', zenkit.vfsResolve(handle, 'EX_BLOB.MMS')],
      ['EX_CRATE.TGA', zenkit.vfsResolve(handle, 'EX_CRATE.TGA')],
      ['EX_LIT.TEX', zenkit.vfsResolve(handle, 'EX_LIT.TEX')],
    ],
    [
      ['EX_CRATE.3DS', 'EX_CRATE.MRM'],
      ['EX_PLATE.3DS', 'EX_PLATE.MSH'], // .MRM absent, so the .MSH fallback
      ['EX_HERO.ASC', 'EX_HERO.MDL'],
      ['EX_HERO.MDS', 'EX_HERO.MDL'],
      ['EX_GOBBO.ASC', 'EX_GOBBO.MDM'], // .MDL absent, so the .MDM fallback
      ['EX_BLOB.MMS', 'EX_BLOB.MMB'],
      ['EX_CRATE.TGA', 'EX_CRATE-C.TEX'],
      ['EX_LIT.TEX', 'EX_LIT.TEX'], // an already-compiled name passes through
    ],
  );
});

test('vfsResolve prefers the first candidate when several exist', () => {
  // EX_DUAL has both an .MRM and an .MSH; EX_HERO both an .MDL and an .MDM.
  // Without a fixture carrying both, a wrong preference order is invisible.
  const handle = vfs();
  assert.strictEqual(zenkit.vfsResolve(handle, 'EX_DUAL.3DS'), 'EX_DUAL.MRM');
  assert.strictEqual(zenkit.vfsResolve(handle, 'EX_HERO.ASC'), 'EX_HERO.MDL');
});

test('vfsResolve upper-cases the name it looks up', () => {
  const handle = vfs();
  assert.strictEqual(zenkit.vfsResolve(handle, 'ex_crate.3ds'), 'EX_CRATE.MRM');
  assert.strictEqual(zenkit.vfsResolve(handle, 'Ex_Crate.Tga'), 'EX_CRATE-C.TEX');
});

test('vfsResolve returns null for a name nothing maps to', () => {
  const handle = vfs();
  assert.strictEqual(zenkit.vfsResolve(handle, 'EX_MISSING.3DS'), null);
  assert.strictEqual(zenkit.vfsResolve(handle, 'EX_MISSING.TGA'), null);
});

// --- extractVisual: proto meshes ----------------------------------------

const crate = () => zenkit.extractVisual(vfs(), 'EX_CRATE.3DS');

test('extractVisual emits one chunk per sub-mesh and names its source', () => {
  const payload = crate();

  // EX_EMPTY has wedges but no triangles: it contributes no geometry, so it
  // gets no chunk.
  assert.strictEqual(payload.source, 'EX_CRATE.MRM');
  assert.deepStrictEqual(
    payload.chunks.map((c) => [c.name, c.texture, c.vertexCount, c.triangleCount]),
    [
      ['EX_WOOD', 'EX_WOOD.TGA', 4, 2],
      ['EX_IRON', 'EX_IRON.TGA', 3, 1],
    ],
  );
  assert.strictEqual(payload.vertexCount, 7);
  assert.strictEqual(payload.triangleCount, 3);
});

test('extractVisual reports the sub-mesh index, not the chunk index', () => {
  // The same field name as an extractWorldMesh chunk, so it has to mean the
  // same thing: an index into the mesh's own material list. EX_IRON is
  // sub-mesh 2 even though the skipped EX_EMPTY makes it chunk 1.
  assert.deepStrictEqual(crate().chunks.map((c) => c.materialIndex), [0, 2]);
});

test('extractVisual resolves each wedge to its position', () => {
  const [wood, iron] = crate().chunks;

  // A wedge is a ready-made render vertex — a position index plus its own
  // normal and UV — so unlike zCMesh there is nothing to de-duplicate.
  assert.deepStrictEqual(f32(wood.positions), [
    0, 0, 0, //
    10, 0, 0, //
    10, 0, 10, //
    0, 0, 10,
  ]);
  assert.deepStrictEqual(f32(wood.uvs), [0, 0, 1, 0, 1, 1, 0, 1]);
  assert.deepStrictEqual(f32(wood.normals), [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);

  // iron's wedges point at positions 1, 2 and 4 — not 0, 1, 2.
  assert.deepStrictEqual(f32(iron.positions), [10, 0, 0, 10, 0, 10, 5, 20, 5]);
  assert.deepStrictEqual(f32(iron.normals), [1, 0, 0, 1, 0, 0, 1, 0, 0]);
});

test('extractVisual emits triangle indices in stored order', () => {
  const [wood, iron] = crate().chunks;

  // Unreversed, with no winding claim attached: winding is settled by
  // measurement against the stored wedge normals, not asserted by the binding.
  // The iron triangle is stored descending, so a sorted or flipped emission
  // would not survive this.
  assert.deepStrictEqual(u32(wood.indices), [0, 1, 2, 0, 2, 3]);
  assert.deepStrictEqual(u32(iron.indices), [2, 1, 0]);
});

test('extractVisual carries no lights or flags for a proto mesh', () => {
  // A VOB visual has no baked ZenGin light word and no per-polygon flags;
  // emitting empty buffers would claim data that does not exist.
  for (const chunk of crate().chunks) {
    assert.strictEqual(chunk.lights, undefined);
    assert.strictEqual(chunk.flags, undefined);
  }
});

test("extractVisual computes the bbox from the wedges it emits", () => {
  // The fixture's own bbox is a deliberately wrong +/-999 box, and the skipped
  // EX_EMPTY sub-mesh is the only thing referencing (-100, -100, -100).
  assert.deepStrictEqual(crate().bbox, [0, 0, 0, 10, 20, 10]);
});

test('extractVisual buffer lengths agree with the declared counts', () => {
  for (const chunk of crate().chunks) {
    assert.strictEqual(chunk.positions.byteLength, chunk.vertexCount * 3 * 4);
    assert.strictEqual(chunk.normals.byteLength, chunk.vertexCount * 3 * 4);
    assert.strictEqual(chunk.uvs.byteLength, chunk.vertexCount * 2 * 4);
    assert.strictEqual(chunk.indices.byteLength, chunk.triangleCount * 3 * 4);
    // Transferable to the renderer as-is (level-editor.md §7).
    assert.ok(chunk.positions instanceof ArrayBuffer);
  }
});

test('extractVisual returns null for a name nothing maps to', () => {
  assert.strictEqual(zenkit.extractVisual(vfs(), 'EX_MISSING.3DS'), null);
  // A texture is not a visual: the visual candidates never reach a .TEX.
  assert.strictEqual(zenkit.extractVisual(vfs(), 'EX_LIT.TEX'), null);
});

// --- extractVisual: compiled zCMesh visuals ------------------------------

test('extractVisual reads a compiled .MSH as the same projection as the world mesh', () => {
  // EX_PLATE.MSH is byte-for-byte the mesh the extractWorldMesh test uses, so
  // the .MSH branch has to reproduce that test's chunks exactly — including
  // the per-vertex light word and per-triangle flags only a zCMesh carries.
  const payload = zenkit.extractVisual(vfs(), 'EX_PLATE.3DS');

  assert.strictEqual(payload.source, 'EX_PLATE.MSH');
  assert.deepStrictEqual(
    payload.chunks.map((c) => [c.materialIndex, c.name, c.vertexCount, c.triangleCount]),
    [
      [0, 'EX_STONE', 6, 3],
      [1, 'EX_GRASS', 3, 1],
    ],
  );

  const [stone] = payload.chunks;
  assert.deepStrictEqual(u32(stone.indices), [0, 1, 2, 0, 2, 3, 4, 2, 5]);
  assert.deepStrictEqual(u32(stone.flags), [0, 0, 1]);
  assert.deepStrictEqual(u32(stone.lights), [
    0x01020300, 0x01020301, 0x01020302, 0x01020303, 0x0a0b0c0d, 0x01020304,
  ]);
});

// --- decodeTexture -------------------------------------------------------

test('decodeTexture returns RGBA8, so the renderer never sees a compressed format', () => {
  const texture = zenkit.decodeTexture(vfs(), 'EX_CRATE.TGA');

  assert.strictEqual(texture.source, 'EX_CRATE-C.TEX');
  assert.deepStrictEqual(
    [texture.width, texture.height, texture.mipmaps],
    [2, 2, 2],
  );
  assert.strictEqual(texture.rgba.byteLength, 2 * 2 * 4);
  assert.deepStrictEqual(Array.from(new Uint8Array(texture.rgba)), [
    0xff, 0x00, 0x00, 0xff, //
    0x00, 0xff, 0x00, 0xff, //
    0x00, 0x00, 0xff, 0xff, //
    0xff, 0xff, 0x00, 0x80,
  ]);
  assert.ok(texture.rgba instanceof ArrayBuffer);
});

test('decodeTexture selects the requested mipmap level', () => {
  const level1 = zenkit.decodeTexture(vfs(), 'EX_CRATE.TGA', 1);

  assert.deepStrictEqual([level1.width, level1.height], [1, 1]);
  assert.deepStrictEqual(Array.from(new Uint8Array(level1.rgba)), [0x40, 0x50, 0x60, 0x70]);
});

test('decodeTexture refuses a mipmap level the texture does not have', () => {
  assert.throws(
    () => zenkit.decodeTexture(vfs(), 'EX_CRATE.TGA', 2),
    /mipmap level 2 does not exist .*\(2 levels\)/,
  );
  assert.throws(() => zenkit.decodeTexture(vfs(), 'EX_CRATE.TGA', -1), /must not be negative/);
});

test('decodeTexture returns null for a name nothing maps to', () => {
  assert.strictEqual(zenkit.decodeTexture(vfs(), 'EX_MISSING.TGA'), null);
});
