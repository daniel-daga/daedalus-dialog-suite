// Turning a loaded world into something a viewport can draw (level-editor.md
// §3, §7). The decisions here are the ones the spike had to discover on retail
// data, and every one of them is invisible when it goes wrong:
//
//   - a zCVobLevelCompo drawn is the world drawn twice
//   - one Mesh per VOB is 12k draw calls against a 1500 budget
//   - an unresolved visual is a normal fact about a world, not an error
//
// The binding is injected, so all of this is exercised without the native
// addon and without a Gothic install.

import {
  buildInstancedVisuals, buildVisual, buildWorldMesh, visualBounds,
  type SceneBinding, type VobIndex,
} from '../src/scene';
import type { MeshChunk } from '../src/render';

function chunk(texture: string): MeshChunk {
  return {
    name: 'MAT', texture, group: 0, color: [255, 255, 255, 255],
    alphaFunc: 0, texAniMapMode: 0, texAniFps: 0, texAniMapDir: [0, 0],
    envMapping: false, envMappingStrength: 0,
    waveMode: 0, waveSpeed: 0, waveMaxAmplitude: 0, waveGridSize: 0,
    ignoreSun: false, disableLightmap: false,
    vertexCount: 3, triangleCount: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer,
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
    indices: new Uint32Array([0, 1, 2]).buffer,
    lights: null,
  };
}

/** A VOB table in the columnar shape `vobIndex` emits. */
function vobIndex(vobs: Array<{ cls?: string; visual?: string; visualType?: string; pos?: number[]; rot?: number[] }>): VobIndex {
  const classes: string[] = [];
  const visuals: string[] = [];
  const visualTypes: string[] = [];
  const intern = (dict: string[], value: string) => {
    const at = dict.indexOf(value);
    return at === -1 ? dict.push(value) - 1 : at;
  };

  const positions = new Float32Array(vobs.length * 3);
  const rotations = new Float32Array(vobs.length * 9);
  const classIndex = new Uint32Array(vobs.length);
  const visualIndex = new Uint32Array(vobs.length);
  const visualTypeIndex = new Uint32Array(vobs.length);

  vobs.forEach((vob, i) => {
    classIndex[i] = intern(classes, vob.cls ?? 'zCVob');
    visualIndex[i] = intern(visuals, vob.visual ?? '');
    visualTypeIndex[i] = intern(visualTypes, vob.visualType ?? 'MULTI_RESOLUTION_MESH');
    const p = vob.pos ?? [i, 0, 0];
    positions.set(p, i * 3);
    rotations.set(vob.rot ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);
  });

  return {
    count: vobs.length,
    parent: new Int32Array(vobs.length).fill(-1).buffer,
    childIndex: new Uint32Array(vobs.length).buffer,
    positions: positions.buffer,
    rotations: rotations.buffer,
    flags: new Uint32Array(vobs.length).fill(1).buffer,
    classes, classIndex: classIndex.buffer,
    names: [''], nameIndex: new Uint32Array(vobs.length).buffer,
    visuals, visualIndex: visualIndex.buffer,
    visualTypes, visualTypeIndex: visualTypeIndex.buffer,
  };
}

function binding(resolve: (name: string) => MeshChunk[] | null): SceneBinding & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    extractWorldMesh: () => ({
      bbox: [0, 0, 0, 100, 100, 100],
      vertexCount: 6,
      triangleCount: 2,
      chunks: [chunk('A.TGA'), chunk('A.TGA'), chunk('B.TGA')],
    }),
    extractVisual: (_vfs, name) => {
      calls.push(name);
      const chunks = resolve(name);
      return chunks === null ? null : { source: name, chunks };
    },
  };
}

const HANDLE = {};
const VFS = {};

describe('zen-world/scene — buildWorldMesh', () => {
  test('materials become merged draw groups, and the bbox comes through', () => {
    const mesh = buildWorldMesh(binding(() => null), HANDLE);
    expect(mesh.groups).toHaveLength(2);           // A.TGA twice, B.TGA once
    expect(mesh.groups[0].materials).toBe(2);
    expect(mesh.bbox).toEqual([0, 0, 0, 100, 100, 100]);
    expect(mesh.stats).toEqual({ materials: 3, drawGroups: 2, triangles: 2 });
  });
});

describe('zen-world/scene — visualBounds', () => {
  // The bounds of a visual a VOB is being *given*. Every other op refits its box
  // from bounds that crossed with the geometry; a visual the world does not
  // currently use has no instance and no payload, so this is the one that has to
  // be asked for.

  test('is the box the scene would have given that visual', () => {
    // Not "a box computed the same way" — the *same* box. Two implementations
    // that agree today are two implementations that can drift, and the one that
    // drifts is the one the engine culls by.
    const b = binding(() => [chunk('A.TGA')]);
    const scene = buildInstancedVisuals(b, VFS, vobIndex([{ visual: 'BARREL.3DS' }]));

    expect(visualBounds(b, VFS, 'BARREL.3DS')).toEqual(scene.visuals[0].bounds);
  });

  test('applies an attachment\'s node transform, because it goes through the merge', () => {
    // Bounds taken before the merge place a chest's lid at the chest's origin —
    // the defect `mergeChunks` exists to have fixed, and a box that inherited it
    // would cull a swapped visual by a box a metre from where it is drawn.
    const attached = { ...chunk('A.TGA'), node: 'LID', transform: [1, 0, 0, 100, 0, 1, 0, 0, 0, 0, 1, 0] };
    const b = binding(() => [attached]);

    const bounds = visualBounds(b, VFS, 'CHEST.3DS')!;

    expect(bounds[0]).toBeCloseTo(100);
    expect(bounds[3]).toBeCloseTo(101);
  });

  test('is null for a name that does not resolve', () => {
    // A decal names a texture and a `.pfx` is a Daedalus instance; neither is in
    // the VFS. The op then leaves the stale box alone rather than refitting it
    // to nothing, which is the answer a rotation gives for the same reason.
    expect(visualBounds(binding(() => null), VFS, 'PFX_SMOKE')).toBeNull();
  });

  test('is null for a visual that resolves to no geometry', () => {
    expect(visualBounds(binding(() => []), VFS, 'EMPTY.3DS')).toBeNull();
  });
});

describe('zen-world/scene — buildVisual', () => {
  // One visual on its own, for the asset preview (level-editor.md §16.26 row
  // 1): the same merged draw groups the instanced scene would place, with the
  // same bounds, and no VOB placing it.

  test('is the draw groups and bounds the scene would have given that visual', () => {
    const b = binding(() => [chunk('A.TGA'), chunk('A.TGA'), chunk('B.TGA')]);
    const scene = buildInstancedVisuals(b, VFS, vobIndex([{ visual: 'BARREL.3DS' }]));

    const visual = buildVisual(b, VFS, 'BARREL.3DS')!;

    expect(visual.name).toBe('BARREL.3DS');
    expect(visual.source).toBe('BARREL.3DS');
    expect(visual.groups).toHaveLength(2);
    expect(visual.groups.map((g) => g.materials)).toEqual([2, 1]);
    expect(visual.bounds).toEqual(scene.visuals[0].bounds);
    expect(visual.triangleCount).toBe(3);
  });

  test("applies an attachment's node transform, because it goes through the merge", () => {
    const attached = { ...chunk('A.TGA'), node: 'LID', transform: [1, 0, 0, 100, 0, 1, 0, 0, 0, 0, 1, 0] };
    const visual = buildVisual(binding(() => [attached]), VFS, 'CHEST.3DS')!;

    expect(new Float32Array(visual.groups[0].positions)[0]).toBeCloseTo(100);
    expect(visual.bounds[0]).toBeCloseTo(100);
  });

  test('is null for a name that does not resolve, and for one with no geometry', () => {
    expect(buildVisual(binding(() => null), VFS, 'PFX_SMOKE')).toBeNull();
    expect(buildVisual(binding(() => []), VFS, 'EMPTY.3DS')).toBeNull();
  });

  test("visualBounds is buildVisual's bounds — one path, not two that agree", () => {
    const b = binding(() => [chunk('A.TGA')]);
    expect(visualBounds(b, VFS, 'BARREL.3DS')).toEqual(buildVisual(b, VFS, 'BARREL.3DS')!.bounds);
  });
});

describe('zen-world/scene — buildInstancedVisuals', () => {
  test('VOBs sharing a visual collapse into one instanced entry', () => {
    // Rule 1 of §3: never one Mesh per VOB. This is the rule, as a test.
    const b = binding(() => [chunk('A.TGA')]);
    const built = buildInstancedVisuals(b, VFS, vobIndex([
      { visual: 'BARREL.3DS' }, { visual: 'BARREL.3DS' }, { visual: 'BARREL.3DS' },
    ]));

    expect(built.visuals).toHaveLength(1);
    expect(built.visuals[0].name).toBe('BARREL.3DS');
    expect(built.visuals[0].count).toBe(3);
    expect(built.stats.vobsPlaced).toBe(3);
    expect(built.stats.instancedDrawGroups).toBe(1);
  });

  test('a visual is extracted once however many VOBs name it', () => {
    // 12,463 VOBs name 379 visuals; extracting per VOB would be the whole cold
    // open. The call log is the only way to see this from outside.
    const b = binding(() => [chunk('A.TGA')]);
    buildInstancedVisuals(b, VFS, vobIndex([
      { visual: 'BARREL.3DS' }, { visual: 'BARREL.3DS' }, { visual: 'CRATE.3DS' },
    ]));
    expect(b.calls).toEqual(['BARREL.3DS', 'CRATE.3DS']);
  });

  test('a zCVobLevelCompo is never resolved and never placed', () => {
    // Measured: 100% of NewWorld_Part_Xardas_01's vertex positions are already
    // in NewWorld's world mesh. Drawing the compo draws the world twice.
    const b = binding(() => [chunk('A.TGA')]);
    const built = buildInstancedVisuals(b, VFS, vobIndex([
      { cls: 'zCVobLevelCompo', visual: 'NEWWORLD_PART_XARDAS_01.3DS', visualType: 'MESH' },
      { visual: 'BARREL.3DS' },
    ]));

    expect(b.calls).toEqual(['BARREL.3DS']);
    expect(built.stats.vobsPlaced).toBe(1);
    expect(built.stats.levelCompos).toBe(1);
    expect(built.visuals.map((v) => v.name)).toEqual(['BARREL.3DS']);
  });

  test('a VOB with no visual is skipped without asking the VFS for ""', () => {
    const b = binding(() => [chunk('A.TGA')]);
    const built = buildInstancedVisuals(b, VFS, vobIndex([{ visual: '' }, { visual: 'BARREL.3DS' }]));
    expect(b.calls).toEqual(['BARREL.3DS']);
    expect(built.stats.vobsPlaced).toBe(1);
  });

  test('an unresolved visual is counted by type, not thrown', () => {
    // DECAL and PARTICLE_EFFECT are correctly unresolvable — a decal names a
    // texture and a .pfx is a Daedalus instance. Treating that as an error
    // would fail every retail world.
    const b = binding((name) => (name === 'BARREL.3DS' ? [chunk('A.TGA')] : null));
    const built = buildInstancedVisuals(b, VFS, vobIndex([
      { visual: 'SMOKE.PFX', visualType: 'PARTICLE_EFFECT' },
      { visual: 'BLOOD.TGA', visualType: 'DECAL' },
      { visual: 'BLOOD.TGA', visualType: 'DECAL' },
      { visual: 'BARREL.3DS' },
    ]));

    expect(built.visuals.map((v) => v.name)).toEqual(['BARREL.3DS']);
    expect(built.stats.unresolvedByType).toEqual({ PARTICLE_EFFECT: 1, DECAL: 2 });
    expect(built.stats.vobsPlaced).toBe(1);
  });

  test('each instance carries its placement and the VOB it came from', () => {
    // Selection needs the VOB behind an instance: a pick returns an
    // (InstancedMesh, instanceId) pair and nothing else identifies the object.
    const b = binding(() => [chunk('A.TGA')]);
    // A deliberately asymmetric rotation: against an identity one a transposed
    // matrix is indistinguishable from a correct one, so the row/column
    // convention would go untested.
    const rot = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const built = buildInstancedVisuals(b, VFS, vobIndex([
      { visual: '' },
      { visual: 'BARREL.3DS', pos: [10, 20, 30], rot },
      { visual: 'CRATE.3DS' },
      { visual: 'BARREL.3DS', pos: [40, 50, 60] },
    ]));

    const barrel = built.visuals.find((v) => v.name === 'BARREL.3DS')!;
    expect([...new Uint32Array(barrel.vobIds)]).toEqual([1, 3]);

    // Row-major 3x4 in ZenGin space, unconverted: each rotation row followed by
    // one component of the position.
    expect([...new Float32Array(barrel.matrices)]).toEqual([
      1, 2, 3, 10, 4, 5, 6, 20, 7, 8, 9, 30,
      1, 0, 0, 40, 0, 1, 0, 50, 0, 0, 1, 60,
    ]);
  });

  test('a visual carries its own bounds, taken after the merge', () => {
    // A rotation refits the VOB's bbox, and the box a retail world stores is
    // the tight world AABB of the visual placed by the VOB's transform
    // (measured — zenkit-node's check-vob-bbox.js). Refitting needs the
    // visual's own bounds and nothing else, so they are computed here where the
    // merged buffers are already in hand.
    //
    // **After** the merge, because that is where an attachment's node transform
    // has been applied: bounds taken from the raw chunks would put a chest's
    // lid at the chest's origin.
    const scene = buildInstancedVisuals(
      binding(() => [
        chunk('A.TGA'),
        // An attachment 100 up — the whole point of taking bounds after the
        // merge rather than before it.
        { ...chunk('B.TGA'), transform: [1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1, 0] },
      ]),
      VFS,
      vobIndex([{ visual: 'CHEST.3DS' }]),
    );

    // chunk() is a triangle spanning (0,0,0)-(1,1,0); the attachment copy of it
    // sits 100 higher.
    expect(scene.visuals[0].bounds).toEqual([0, 0, 0, 1, 101, 0]);
  });

  test('a visual with no vertices gets a zero box, not an infinite one', () => {
    // The sweep's sentinels are Infinity, and an infinite bbox is a box the
    // engine cannot cull by.
    const scene = buildInstancedVisuals(
      binding(() => [{
        ...chunk('A.TGA'),
        vertexCount: 0,
        triangleCount: 0,
        positions: new ArrayBuffer(0),
        normals: new ArrayBuffer(0),
        uvs: new ArrayBuffer(0),
        indices: new ArrayBuffer(0),
      }]),
      VFS,
      vobIndex([{ visual: 'EMPTY.3DS' }]),
    );

    expect(scene.visuals[0].bounds).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test('a visual that resolves to no geometry is not an instanced entry', () => {
    const b = binding(() => []);
    const built = buildInstancedVisuals(b, VFS, vobIndex([{ visual: 'EMPTY.3DS' }]));
    expect(built.visuals).toEqual([]);
  });
});
