'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');

// The mesh-extraction fixture (src/fixture.cc BuildMeshExtractionMesh) is
// authored into a temp directory rather than checked in: it backs no fidelity
// claim, so unlike test/fixtures/minimal.g2.zen it carries no golden dump and
// is free to change alongside the extractor it exercises.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-extract-'));
const FIXTURE = path.join(dir, 'mesh-extraction.g2.zen');
zenkit._authorFixtureWorld(FIXTURE, 'binsafe', 'g2', 'mesh-extraction');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function extract() {
  return zenkit.extractWorldMesh(zenkit.loadWorld(FIXTURE, 'g2'));
}

const f32 = (buf) => Array.from(new Float32Array(buf));
const u32 = (buf) => Array.from(new Uint32Array(buf));

test('extractWorldMesh chunks by material and skips materials no polygon uses', () => {
  const payload = extract();

  // EX_UNUSED is declared in the material list but referenced by no polygon.
  assert.strictEqual(payload.chunks.length, 2);
  assert.deepStrictEqual(
    payload.chunks.map((c) => [c.materialIndex, c.name, c.texture]),
    [
      [0, 'EX_STONE', 'EX_STONE.TGA'],
      [1, 'EX_GRASS', 'EX_GRASS.TGA'],
    ],
  );
});

test('extractWorldMesh computes the bbox from the vertices it emits', () => {
  // Not copied from Mesh::bbox: retail zCMesh world meshes store an all-zero
  // box (measured on NewWorld, OldWorld and AddonWorld), so a copied one is
  // useless exactly where it matters — a viewport that frames the world by it
  // puts the camera at the origin and never moves. The fixture declares a
  // deliberately wrong +/-999 box; the emitted vertices span x 0..20, z 0..10
  // and are flat at y 0, and that is what the payload has to report.
  assert.deepStrictEqual(extract().bbox, [0, 0, 0, 20, 0, 10]);
});

test('extractWorldMesh fan-triangulates n-gons', () => {
  const [stone] = extract().chunks;

  // The quad (0,1,2,3) fans into (0,1,2) and (0,2,3); the third triangle is
  // the second polygon of the same material. ZenKit's own Mesh::triangulate
  // is deliberately not used as the source: it is filtered to BSP leaves and
  // silently drops is_portal, is_ghost_occluder and is_outdoor polygons.
  assert.strictEqual(stone.triangleCount, 3);
  assert.deepStrictEqual(u32(stone.indices), [0, 1, 2, 0, 2, 3, 4, 2, 5]);
});

test('extractWorldMesh keys vertices on the (vertex, feature) pair', () => {
  const [stone] = extract().chunks;

  // Nine triangle corners collapse to six render vertices. Vertex 1 appears
  // twice — once with feature 1, once with feature 6 — and must NOT be
  // merged, because the two corners carry different UVs, normals and light.
  assert.strictEqual(stone.vertexCount, 6);
  assert.deepStrictEqual(f32(stone.positions), [
    0, 0, 0, // v0 / f0
    10, 0, 0, // v1 / f1
    10, 0, 10, // v2 / f2
    0, 0, 10, // v3 / f3
    10, 0, 0, // v1 / f6 — same position, different feature
    20, 0, 0, // v4 / f4
  ]);
  assert.deepStrictEqual(f32(stone.uvs), [0, 0, 1, 2, 2, 4, 3, 6, 9, 9, 4, 8]);
  assert.deepStrictEqual(f32(stone.normals), [
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    1, 0, 0, // feature 6 is the only one with a different normal
    0, 1, 0,
  ]);
});

test('extractWorldMesh emits the raw ZenGin light word per vertex', () => {
  const [stone] = extract().chunks;

  // Emitted undecoded: the zCOLOR channel order is a rendering question that
  // belongs to the projection layer, where it can be verified visually.
  assert.deepStrictEqual(u32(stone.lights), [
    0x01020300, 0x01020301, 0x01020302, 0x01020303, 0x0a0b0c0d, 0x01020304,
  ]);
});

test('extractWorldMesh carries per-triangle polygon flags', () => {
  const [stone, grass] = extract().chunks;

  // Same packing as _drillMesh flagsBits (src/normalize.cc PackPolygonFlags).
  // Both triangles of the fanned quad inherit the polygon's flags.
  assert.deepStrictEqual(u32(stone.flags), [0, 0, 1]); // is_portal on polygon 1
  assert.deepStrictEqual(u32(grass.flags), [8]); // is_sector on polygon 2
});

test('extractWorldMesh totals match the sum over chunks', () => {
  const payload = extract();
  const [stone, grass] = payload.chunks;

  assert.strictEqual(grass.vertexCount, 3);
  assert.strictEqual(grass.triangleCount, 1);
  assert.deepStrictEqual(f32(grass.positions), [20, 0, 0, 20, 0, 10, 10, 0, 10]);

  assert.strictEqual(payload.vertexCount, stone.vertexCount + grass.vertexCount);
  assert.strictEqual(payload.triangleCount, stone.triangleCount + grass.triangleCount);
});

test('extractWorldMesh buffer lengths agree with the declared counts', () => {
  for (const chunk of extract().chunks) {
    assert.strictEqual(chunk.positions.byteLength, chunk.vertexCount * 3 * 4);
    assert.strictEqual(chunk.normals.byteLength, chunk.vertexCount * 3 * 4);
    assert.strictEqual(chunk.uvs.byteLength, chunk.vertexCount * 2 * 4);
    assert.strictEqual(chunk.lights.byteLength, chunk.vertexCount * 4);
    assert.strictEqual(chunk.indices.byteLength, chunk.triangleCount * 3 * 4);
    assert.strictEqual(chunk.flags.byteLength, chunk.triangleCount * 4);
    // Transferable to the renderer as-is (level-editor.md §7).
    assert.ok(chunk.positions instanceof ArrayBuffer);
  }
});

test('extractWorldMesh emits the render state a merge key has to include', () => {
  const [stone, grass] = extract().chunks;

  // Chunks are per material, but 1400 NewWorld materials share 330 textures,
  // so the projection layer merges chunks by texture (level-editor.md §3). A
  // merge key of texture alone would silently collapse two materials that
  // render differently — an additive-blend flame into an opaque wall — so the
  // binding emits every field that changes the rendered result. EX_STONE
  // carries a non-default value for each of them; EX_GRASS carries none.
  assert.deepStrictEqual(
    {
      alphaFunc: stone.alphaFunc,
      texAniMapMode: stone.texAniMapMode,
      texAniFps: stone.texAniFps,
      texAniMapDir: stone.texAniMapDir,
      envMapping: stone.envMapping,
      envMappingStrength: stone.envMappingStrength,
      waveMode: stone.waveMode,
      waveSpeed: stone.waveSpeed,
      waveMaxAmplitude: stone.waveMaxAmplitude,
      waveGridSize: stone.waveGridSize,
      ignoreSun: stone.ignoreSun,
      disableLightmap: stone.disableLightmap,
    },
    {
      alphaFunc: 2, // AlphaFunction::BLEND
      texAniMapMode: 1, // AnimationMapping::LINEAR
      texAniFps: 5,
      texAniMapDir: [0.25, -0.5],
      envMapping: true,
      envMappingStrength: 0.75,
      waveMode: 7, // WaveMode::WIND
      waveSpeed: 3, // WaveSpeed::FAST
      waveMaxAmplitude: 12.5,
      waveGridSize: 40,
      ignoreSun: true,
      disableLightmap: true,
    },
  );

  assert.deepStrictEqual(
    {
      alphaFunc: grass.alphaFunc,
      texAniMapMode: grass.texAniMapMode,
      texAniFps: grass.texAniFps,
      texAniMapDir: grass.texAniMapDir,
      envMapping: grass.envMapping,
      envMappingStrength: grass.envMappingStrength,
      waveMode: grass.waveMode,
      waveSpeed: grass.waveSpeed,
      waveMaxAmplitude: grass.waveMaxAmplitude,
      waveGridSize: grass.waveGridSize,
      ignoreSun: grass.ignoreSun,
      disableLightmap: grass.disableLightmap,
    },
    {
      alphaFunc: 1, // AlphaFunction::NONE — ZenGin's default for a plain material
      texAniMapMode: 0,
      texAniFps: 0,
      texAniMapDir: [0, 0],
      envMapping: false,
      envMappingStrength: 0,
      waveMode: 0,
      waveSpeed: 0,
      waveMaxAmplitude: 0,
      waveGridSize: 0,
      ignoreSun: false,
      disableLightmap: false,
    },
  );
});

test('extractWorldMesh leaves positions in ZenGin space', () => {
  // Authoritative data is always ZenGin-space (cm, ZenGin handedness); the
  // single conversion to Three.js space lives in zen-world/coords (§7). The
  // fixture quad spans x 0..20, z 0..10 with y flat at 0 — no axis flipped,
  // no unit scaled.
  const [stone] = extract().chunks;
  const positions = f32(stone.positions);
  const xs = positions.filter((_, i) => i % 3 === 0);
  const ys = positions.filter((_, i) => i % 3 === 1);
  const zs = positions.filter((_, i) => i % 3 === 2);

  assert.deepStrictEqual([Math.min(...xs), Math.max(...xs)], [0, 20]);
  assert.deepStrictEqual([Math.min(...ys), Math.max(...ys)], [0, 0]);
  assert.deepStrictEqual([Math.min(...zs), Math.max(...zs)], [0, 10]);
});
