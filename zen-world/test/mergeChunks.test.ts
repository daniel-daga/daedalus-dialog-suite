// The draw-group merge (level-editor.md §3). `zenkit-node` emits one chunk per
// material — 1400 of them on NewWorld — and one draw call per material is over
// the whole viewport budget before a single VOB is drawn. Merging by the
// measured key gives 352 groups.
//
// The load-bearing risk is not "does it merge" but "does it merge things that
// must not merge": a field missing from the key is an additive-blend flame
// inside an opaque wall, with nothing reporting a problem. So the field table
// below is written out by hand and checked *against* the implementation's list,
// rather than being read from it — a test that iterates the implementation's
// own key agrees with it by construction and would pass on an empty key.

import { mergeChunks, MERGE_KEY_FIELDS, type MeshChunk } from '../src/render';

function f32(values: number[]): ArrayBuffer {
  return new Float32Array(values).buffer;
}
function u32(values: number[]): ArrayBuffer {
  return new Uint32Array(values).buffer;
}

/** One triangle, three vertices — enough to see concatenation and re-basing. */
function chunk(overrides: Partial<MeshChunk> = {}): MeshChunk {
  return {
    name: 'MAT',
    texture: 'NW_WOOD.TGA',
    group: 0,
    color: [255, 255, 255, 255],
    alphaFunc: 0,
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
    vertexCount: 3,
    triangleCount: 1,
    positions: f32([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: f32([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: f32([0, 0, 1, 0, 0, 1]),
    indices: u32([0, 1, 2]),
    lights: u32([1, 2, 3]),
    ...overrides,
  };
}

// Each entry names a merge-key field and a value that differs from chunk()'s
// default. Written out here, not derived from the implementation.
const PERTURBATIONS: Record<string, Partial<MeshChunk>> = {
  texture: { texture: 'NW_STONE.TGA' },
  color: { color: [255, 0, 0, 255] },
  alphaFunc: { alphaFunc: 2 },
  texAniMapMode: { texAniMapMode: 1 },
  texAniFps: { texAniFps: 12 },
  texAniMapDir: { texAniMapDir: [0.5, 0] },
  envMapping: { envMapping: true },
  envMappingStrength: { envMappingStrength: 0.75 },
  waveMode: { waveMode: 3 },
  waveSpeed: { waveSpeed: 2 },
  waveMaxAmplitude: { waveMaxAmplitude: 4 },
  waveGridSize: { waveGridSize: 8 },
  ignoreSun: { ignoreSun: true },
  disableLightmap: { disableLightmap: true },
};

describe('zen-world/render — mergeChunks', () => {
  test('the merge key is exactly the fields measured to matter', () => {
    // Guards both directions: a field dropped from the key, and a field added
    // to the key without anyone deciding it belongs there.
    expect([...MERGE_KEY_FIELDS].sort()).toEqual(Object.keys(PERTURBATIONS).sort());
  });

  test.each(Object.keys(PERTURBATIONS))(
    'chunks differing only in %s refuse to merge',
    (field) => {
      const groups = mergeChunks([chunk(), chunk(PERTURBATIONS[field])]);
      expect(groups).toHaveLength(2);
    },
  );

  test('chunks agreeing on the whole key merge into one draw call', () => {
    const groups = mergeChunks([chunk({ name: 'A' }), chunk({ name: 'B' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].materials).toBe(2);
    expect(groups[0].vertexCount).toBe(6);
    expect(groups[0].triangleCount).toBe(2);
  });

  test('concatenated indices are re-based onto the merged vertex buffer', () => {
    // The bug this exists for: copying index buffers verbatim leaves the second
    // material drawing the first one's triangle, which looks like a modelling
    // error rather than a merge error.
    const groups = mergeChunks([
      chunk(),
      chunk({
        positions: f32([2, 0, 0, 3, 0, 0, 2, 1, 0]),
        indices: u32([0, 1, 2]),
      }),
    ]);
    expect([...new Uint32Array(groups[0].indices)]).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...new Float32Array(groups[0].positions)]).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      2, 0, 0, 3, 0, 0, 2, 1, 0,
    ]);
  });

  test('every attribute buffer is concatenated in the same part order', () => {
    const groups = mergeChunks([
      chunk({ normals: f32([1, 0, 0, 1, 0, 0, 1, 0, 0]), uvs: f32([0, 0, 0, 0, 0, 0]), lights: u32([7, 7, 7]) }),
      chunk({ normals: f32([0, 1, 0, 0, 1, 0, 0, 1, 0]), uvs: f32([1, 1, 1, 1, 1, 1]), lights: u32([9, 9, 9]) }),
    ]);
    expect([...new Float32Array(groups[0].normals)]).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    expect([...new Float32Array(groups[0].uvs)]).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    expect([...new Uint32Array(groups[0].lights!)]).toEqual([7, 7, 7, 9, 9, 9]);
  });

  test('a texture name matches case-insensitively', () => {
    // A VOB names its asset in whatever case the level designer typed; the same
    // texture reached under two spellings is one draw call, not two.
    const groups = mergeChunks([chunk({ texture: 'NW_WOOD.TGA' }), chunk({ texture: 'nw_wood.tga' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].texture).toBe('NW_WOOD.TGA');
  });

  test('untextured chunks are separated by colour and merged by it', () => {
    // 266 of NewWorld's 1400 materials carry no texture at all and differ only
    // in colour — merging those would flatten the world to one shade.
    const red = chunk({ texture: '', color: [255, 0, 0, 255] });
    const blue = chunk({ texture: '', color: [0, 0, 255, 255] });
    expect(mergeChunks([red, blue])).toHaveLength(2);
    expect(mergeChunks([red, chunk({ texture: '', color: [255, 0, 0, 255] })])).toHaveLength(1);
  });

  test('a proto-mesh group carries no lights buffer rather than a zero-filled lie', () => {
    // extractVisual's chunks have no baked ZenGin light word (zenkit-node
    // README). A zero-filled buffer would render every prop black under a
    // vertex-colour material and look like a lighting bug.
    const groups = mergeChunks([chunk({ lights: null }), chunk({ lights: null })]);
    expect(groups[0].lights).toBeNull();
  });

  test('groups come back in first-seen order', () => {
    // Draw order has to be reproducible: a Map-order accident that reshuffles
    // between loads makes a transparency artefact impossible to reproduce.
    const groups = mergeChunks([
      chunk({ texture: 'C.TGA' }), chunk({ texture: 'A.TGA' }),
      chunk({ texture: 'C.TGA' }), chunk({ texture: 'B.TGA' }),
    ]);
    expect(groups.map((g) => g.texture)).toEqual(['C.TGA', 'A.TGA', 'B.TGA']);
  });

  test('no chunks is no groups', () => {
    expect(mergeChunks([])).toEqual([]);
  });
});
