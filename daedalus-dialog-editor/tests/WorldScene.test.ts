/**
 * Scene-graph assertions for the Phase 1a viewport (level-editor.md §17 —
 * "viewport correctness via scene-graph assertions where DOM assertions can't
 * reach"). `WorldScene` deliberately builds the Three.js graph without a
 * WebGLRenderer, so everything the spike had to verify by looking at a picture
 * is checkable here instead:
 *
 *   - the whole scene hangs under ONE mirrored node, and index order goes
 *     through the same boundary, so units and winding are settled in one place
 *     and no material reaches for DoubleSide
 *   - VOBs sharing a visual are one InstancedMesh, not one Mesh each
 *   - an instance can be traced back to the VOB it came from
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { ROOT_MATRIX } from 'zen-world';
import type { DecodedTexture, DrawGroup, InstancedVisual } from '../src/shared/worldTypes';
import { DEFAULT_EXPOSURE, WORLD_LAYER, WorldScene, textureCacheFor } from '../src/renderer/world/WorldScene';

function group(overrides: Partial<DrawGroup> = {}): DrawGroup {
  return {
    texture: 'NW_WOOD.TGA',
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
    materials: 1,
    vertexCount: 3,
    triangleCount: 1,
    positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]).buffer,
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer,
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
    indices: new Uint32Array([0, 1, 2]).buffer,
    lights: new Uint32Array([0xff804020, 0xff804020, 0xff804020]).buffer,
    ...overrides,
  };
}

function visual(overrides: Partial<InstancedVisual> = {}): InstancedVisual {
  return {
    name: 'BARREL.3DS',
    source: 'BARREL.MRM',
    count: 2,
    matrices: new Float32Array([
      1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30,
      1, 0, 0, 40, 0, 1, 0, 50, 0, 0, 1, 60,
    ]).buffer,
    vobIds: new Uint32Array([7, 9]).buffer,
    groups: [group({ lights: null })],
    // The visual's own bounds, which a rotation needs to refit the VOB's bbox.
    // group()'s triangle spans (0,0,0)-(100,100,0).
    bounds: [0, 0, 0, 100, 100, 0],
    ...overrides,
  };
}

/** Run a material's `onBeforeCompile` over the stock basic shader and hand back
 *  what it made of it — the only way to see an injected term without a GPU. */
function compile(material: THREE.MeshBasicMaterial) {
  const shader = {
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    uniforms: {} as Record<string, { value: number }>,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return shader;
}

describe('WorldScene', () => {
  test('the whole scene hangs under one mirrored root', () => {
    // The single ZenGin -> Three.js conversion. If anything else in the graph
    // scaled or flipped an axis, this transform would stop being the only
    // answer to "where is this in the world".
    const scene = new WorldScene();
    expect(scene.root.matrix.elements).toEqual([...ROOT_MATRIX]);
    expect(scene.root.matrixAutoUpdate).toBe(false);
    expect(scene.root.matrix.determinant()).toBeLessThan(0);
  });

  test('materials are single-sided, because the index order settles winding', () => {
    // side: DoubleSide would hide a wrong winding decision instead of proving
    // the right one — explicitly ruled out in §7. So would BackSide, which is
    // the same reversal written as a lie about the material, and which leaves
    // Raycaster culling by the opposite convention from the one drawn.
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group()], bbox: [0, 0, 0, 1, 1, 1] });
    const mesh = scene.root.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.Material).side).toBe(THREE.FrontSide);
  });

  test('every triangle reaches the GPU reversed, world mesh and VOBs alike', () => {
    // The one thing the mirror does not do (zen-world/coords): Three.js cancels
    // a negative determinant's effect on the front/back test, so stored order
    // renders the world inside-out. `threeIndexOrder` is where that is fixed,
    // and this is the assertion that it is actually *called* — the geometry
    // builder is shared, so a VOB proves the same path as the world mesh only
    // if both are checked.
    const stored = new Uint32Array([0, 1, 2, 3, 4, 5]).buffer;
    const reversed = [0, 2, 1, 3, 5, 4];

    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group({ indices: stored })], bbox: [] });
    scene.setInstancedVisuals({ visuals: [visual({ groups: [group({ indices: stored, lights: null })] })] });

    for (const mesh of [scene.root.children[0], scene.root.children[1]] as THREE.Mesh[]) {
      expect([...(mesh.geometry.getIndex()!.array)]).toEqual(reversed);
    }
  });

  test('one draw group becomes one mesh, with the buffers it was given', () => {
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group(), group({ texture: 'NW_STONE.TGA' })], bbox: [] });

    expect(scene.root.children).toHaveLength(2);
    const mesh = scene.root.children[0] as THREE.Mesh;
    expect(mesh.geometry.getAttribute('position').count).toBe(3);
    expect(mesh.geometry.getIndex()!.count).toBe(3);
    expect(mesh.matrixAutoUpdate).toBe(false);
  });

  test('VOBs sharing a visual are one InstancedMesh, not one mesh each', () => {
    // Rule 1 of §3, at the point where it would actually be violated.
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });

    const meshes = scene.root.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes).toHaveLength(1);
    expect((meshes[0] as THREE.InstancedMesh).count).toBe(2);
  });

  test('an instance matrix is read as row-major, the order the payload uses', () => {
    // Against an identity rotation a transpose is invisible, so this one is
    // asymmetric on purpose.
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({
        count: 1,
        matrices: new Float32Array([1, 2, 3, 10, 4, 5, 6, 20, 7, 8, 9, 30]).buffer,
        vobIds: new Uint32Array([7]).buffer,
      })],
      stats: {} as never,
    });

    const mesh = scene.root.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    // Matrix4.elements is column-major; the payload is row-major 3x4.
    expect([...matrix.elements]).toEqual([1, 4, 7, 0, 2, 5, 8, 0, 3, 6, 9, 0, 10, 20, 30, 1]);
  });

  test('a picked instance resolves to the VOB behind it', () => {
    // A pick returns (InstancedMesh, instanceId) and nothing else identifies
    // the object — without this the scene tree cannot follow a click.
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });

    const mesh = scene.root.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    expect(scene.resolveInstance(mesh, 0)).toBe(7);
    expect(scene.resolveInstance(mesh, 1)).toBe(9);
    expect(scene.resolveInstance(mesh, 2)).toBeNull();
  });

  test('the world mesh carries baked vertex light; a VOB visual does not', () => {
    // `lights` is the raw zCOLOR word and the binding refuses to decode it
    // because the channel order is a rendering question. A proto mesh has no
    // such word at all, and a zero-filled stand-in would render every prop
    // black under a vertex-colour material.
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group()], bbox: [] });
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });

    const world = scene.root.children[0] as THREE.Mesh;
    expect(world.geometry.getAttribute('color')).toBeDefined();
    expect((world.material as THREE.MeshBasicMaterial).vertexColors).toBe(true);

    const prop = scene.root.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    expect(prop.geometry.getAttribute('color')).toBeUndefined();
    expect((prop.material as THREE.MeshBasicMaterial).vertexColors).toBe(false);
  });

  test('zCOLOR is decoded as 0xAARRGGBB, not as the byte order it is stored in', () => {
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group({ lights: new Uint32Array([0xff4080c0]).buffer, vertexCount: 1 })], bbox: [] });

    const color = (scene.root.children[0] as THREE.Mesh).geometry.getAttribute('color');
    // R=0x40 G=0x80 B=0xc0, converted sRGB -> linear for the colour buffer.
    const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    expect(color.getX(0)).toBeCloseTo(srgbToLinear(0x40 / 255), 5);
    expect(color.getY(0)).toBeCloseTo(srgbToLinear(0x80 / 255), 5);
    expect(color.getZ(0)).toBeCloseTo(srgbToLinear(0xc0 / 255), 5);
  });

  test('an untextured group takes its colour from the material, not from white', () => {
    // 266 of NewWorld's 1400 materials carry no texture and are told apart only
    // by colour — drawing them white flattens them into one surface.
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group({ texture: '', color: [255, 0, 0, 255] })], bbox: [] });

    const material = (scene.root.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.map).toBeNull();
    expect(material.color.r).toBeCloseTo(1, 5);
    expect(material.color.g).toBeCloseTo(0, 5);
  });

  test('the blend mode a material declares is the blend mode it gets', () => {
    // AlphaFunction: 1 NONE (cut-out), 2 BLEND, 3 ADD. Getting this wrong is
    // the additive-blend flame inside an opaque wall the merge key exists for.
    const scene = new WorldScene();
    scene.setWorldMesh({
      groups: [group({ alphaFunc: 1 }), group({ alphaFunc: 2 }), group({ alphaFunc: 3 })],
      bbox: [],
    });
    const materials = scene.root.children.map((c) => (c as THREE.Mesh).material as THREE.MeshBasicMaterial);

    expect(materials[0].alphaTest).toBeGreaterThan(0);
    expect(materials[1].transparent).toBe(true);
    expect(materials[1].blending).toBe(THREE.NormalBlending);
    expect(materials[2].transparent).toBe(true);
    expect(materials[2].blending).toBe(THREE.AdditiveBlending);
  });

  test('the scene reports which textures it still needs, once each', () => {
    // Textures are decoded on demand — 549 ms of the cold open otherwise, none
    // of it invalidated by an edit. The scene names what it wants; nothing
    // decodes speculatively.
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group(), group(), group({ texture: 'NW_STONE.TGA' }), group({ texture: '' })], bbox: [] });
    scene.setInstancedVisuals({ visuals: [visual({ groups: [group({ texture: 'BARREL.TGA', lights: null })] })], stats: {} as never });

    expect(new Set(scene.pendingTextureNames())).toEqual(
      new Set(['NW_WOOD.TGA', 'NW_STONE.TGA', 'BARREL.TGA']),
    );
  });

  test('a decoded texture reaches every material that named it', () => {
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group(), group(), group({ texture: 'NW_STONE.TGA' })], bbox: [] });
    scene.applyTexture({ name: 'NW_WOOD.TGA', width: 2, height: 2, rgba: new Uint8Array(16).buffer });

    const materials = scene.root.children.map((c) => (c as THREE.Mesh).material as THREE.MeshBasicMaterial);
    expect(materials[0].map).not.toBeNull();
    expect(materials[1].map).toBe(materials[0].map);   // one texture, two materials
    expect(materials[2].map).toBeNull();               // a different name, untouched
    expect(scene.pendingTextureNames()).toEqual(['NW_STONE.TGA']);
  });

  test('dispose releases the geometries and textures it created', () => {
    // A world is reopened as often as a project is; leaking a 30 MB buffer set
    // per open is the kind of thing nothing reports until the app dies.
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group()], bbox: [] });
    const geometry = (scene.root.children[0] as THREE.Mesh).geometry;
    const disposed = jest.spyOn(geometry, 'dispose');

    scene.dispose();

    expect(disposed).toHaveBeenCalled();
    expect(scene.root.children).toHaveLength(0);
  });

  // ── decoded textures across a rebuild (level-editor.md §7) ────────────────
  //
  // A structural op rebuilds the scene, because an instance cannot be appended
  // to an allocated InstancedMesh. Without a cache that rebuild starts from an
  // empty texture map and re-decodes all 490 of NewWorld's — the 549 ms that
  // was deliberately moved off the critical path of the *cold* open, paid again
  // on every placement. Nothing about the pixels changed.

  const decoded = (name: string): DecodedTexture => (
    { name, width: 2, height: 2, rgba: new Uint8Array(16).buffer }
  );

  test('a rebuilt scene asks only for textures the cache does not already hold', async () => {
    const cache = textureCacheFor(null, 'a-world');
    const load = jest.fn(async (name: string) => decoded(name));

    const first = new WorldScene(cache);
    first.setWorldMesh({ groups: [group(), group({ texture: 'NW_STONE.TGA' })], bbox: [] });
    await first.loadPendingTextures(load, () => false);
    expect(load.mock.calls.map(([name]) => name).sort()).toEqual(['NW_STONE.TGA', 'NW_WOOD.TGA']);
    first.dispose();

    // The rebuild a placement forces: the same world, one visual more.
    const second = new WorldScene(cache);
    second.setWorldMesh({
      groups: [group(), group({ texture: 'NW_STONE.TGA' }), group({ texture: 'NW_GRASS.TGA' })],
      bbox: [],
    });
    load.mockClear();
    await second.loadPendingTextures(load, () => false);

    // Only the one it has never seen.
    expect(load.mock.calls.map(([name]) => name)).toEqual(['NW_GRASS.TGA']);
    // And the two it did not ask for are on the rebuilt materials all the same,
    // or the saving would be a scene drawn untextured.
    const materials = second.root.children.map((c) => (c as THREE.Mesh).material as THREE.MeshBasicMaterial);
    expect(materials[0].map).not.toBeNull();
    expect(materials[1].map).not.toBeNull();
    expect(materials[0].map).not.toBe(materials[1].map);
    expect(second.pendingTextureNames()).toEqual([]);
  });

  test('a different world decodes its own textures', async () => {
    // Scoped like the camera pose beside it: keyed on the world, so opening a
    // different one is not served another world's pixels under the same names.
    const cache = textureCacheFor(null, 'a-world');
    const load = jest.fn(async (name: string) => decoded(name));
    const first = new WorldScene(cache);
    first.setWorldMesh({ groups: [group()], bbox: [] });
    await first.loadPendingTextures(load, () => false);
    const stale = jest.spyOn(
      ((first.root.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).map!,
      'dispose',
    );
    first.dispose();

    const other = textureCacheFor(cache, 'another-world');
    expect(other).not.toBe(cache);
    // The previous world's GPU memory goes with it — nothing else holds the
    // cache, so this is the only place it can be released.
    expect(stale).toHaveBeenCalled();

    const second = new WorldScene(other);
    second.setWorldMesh({ groups: [group()], bbox: [] });
    load.mockClear();
    await second.loadPendingTextures(load, () => false);

    expect(load.mock.calls.map(([name]) => name)).toEqual(['NW_WOOD.TGA']);
  });

  test('the same world keeps the cache it had', () => {
    const cache = textureCacheFor(null, 'a-world');
    expect(textureCacheFor(cache, 'a-world')).toBe(cache);
  });

  test('the cache owns disposal, not the scene it was handed to', () => {
    // The trap: a THREE.Texture holds GPU memory, and the scene teardown used
    // to free it. If it still did, the cache would hand the rebuild textures
    // that had already been released.
    const cache = textureCacheFor(null, 'a-world');
    const scene = new WorldScene(cache);
    scene.setWorldMesh({ groups: [group()], bbox: [] });
    scene.applyTexture(decoded('NW_WOOD.TGA'));
    const texture = (scene.root.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const dispose = jest.spyOn(texture.map!, 'dispose');

    scene.dispose();
    expect(dispose).not.toHaveBeenCalled();

    cache.dispose();
    expect(dispose).toHaveBeenCalled();
  });

  test('a scene with no cache still disposes the textures it decoded', () => {
    // The uncached path is what `dispose releases the geometries and textures`
    // above has always covered; naming it here so the cached branch cannot be
    // read as having moved ownership for everyone.
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group()], bbox: [] });
    scene.applyTexture(decoded('NW_WOOD.TGA'));
    const texture = ((scene.root.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).map!;
    const dispose = jest.spyOn(texture, 'dispose');

    scene.dispose();

    expect(dispose).toHaveBeenCalled();
  });

  test('one texture that cannot be decoded does not cost the rest their pixels', async () => {
    // beppo, 2026-09-03: six of `SURFACE_BEPPO`'s texture names resolve to a
    // *source* .TGA sitting loose in the mod folder, which ZenKit refuses with
    // "invalid signature". The rejection came out of this loop and every name
    // after it in the list stayed white — including a tree whose own textures
    // decode perfectly.
    const scene = new WorldScene(null);
    scene.setWorldMesh({
      groups: [
        group({ texture: 'NW_STONE.TGA' }),
        group({ texture: 'KM_SOURCE_TGA.TGA' }),
        group({ texture: 'NW_GRASS.TGA' }),
      ],
      bbox: [],
    });

    const load = jest.fn(async (name: string) => {
      if (name === 'KM_SOURCE_TGA.TGA') throw new Error('invalid signature');
      return decoded(name);
    });

    await expect(scene.loadPendingTextures(load, () => false)).resolves.toEqual(['KM_SOURCE_TGA.TGA']);
    expect(load).toHaveBeenCalledTimes(3);
    expect(scene.pendingTextureNames()).toEqual(['KM_SOURCE_TGA.TGA']);
  });

  test('a name the VFS does not hold is reported too — it is white either way', async () => {
    const scene = new WorldScene(null);
    scene.setWorldMesh({
      groups: [group({ texture: 'NW_STONE.TGA' }), group({ texture: 'GONE.TGA.TGA' })],
      bbox: [],
    });

    const load = jest.fn(async (name: string) => (name === 'GONE.TGA.TGA' ? null : decoded(name)));

    await expect(scene.loadPendingTextures(load, () => false)).resolves.toEqual(['GONE.TGA.TGA']);
  });

  test('a cancelled load stops asking', async () => {
    // The world can be closed while the pump is between awaits, and a decode
    // applied to a torn-down scene is a texture nothing will ever dispose.
    const cache = textureCacheFor(null, 'a-world');
    const scene = new WorldScene(cache);
    scene.setWorldMesh({
      groups: [group(), group({ texture: 'NW_STONE.TGA' }), group({ texture: 'NW_GRASS.TGA' })],
      bbox: [],
    });

    let cancelled = false;
    const load = jest.fn(async (name: string) => { cancelled = true; return decoded(name); });
    await scene.loadPendingTextures(load, () => cancelled);

    expect(load).toHaveBeenCalledTimes(1);
  });

  // ── an edit reaching the scene (level-editor.md §7, Phase 1b) ─────────────
  //
  // An op moves a VOB in the world the main process holds. The viewport has to
  // follow without rebuilding 31 MB of buffers, and two things about how it is
  // drawn make that less obvious than it sounds: a VOB is an *instance* inside
  // a shared InstancedMesh, and a visual with several draw groups puts the same
  // VOB in several of them.

  test('moving a VOB writes the new position into every mesh its visual was split into', () => {
    // A visual with two draw groups is two InstancedMeshes over the same
    // instances. Updating the first one leaves the VOB drawn in both places.
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({ groups: [group({ lights: null }), group({ texture: 'NW_STONE.TGA', lights: null })] })],
      stats: {} as never,
    });

    const meshes = scene.root.children.filter((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    expect(meshes).toHaveLength(2);
    // `needsUpdate` is a setter with no getter; `version` is what it bumps, and
    // it is what decides whether the buffer is re-uploaded to the GPU at all.
    const versions = meshes.map((mesh) => mesh.instanceMatrix.version);

    expect(scene.moveVob(9, [70, 80, 90])).toBe(true);

    const matrix = new THREE.Matrix4();
    meshes.forEach((mesh, at) => {
      // vob 9 is the second instance in the fixture
      mesh.getMatrixAt(1, matrix);
      expect([matrix.elements[12], matrix.elements[13], matrix.elements[14]]).toEqual([70, 80, 90]);
      expect(mesh.instanceMatrix.version).toBeGreaterThan(versions[at]);
    });
  });

  test('a move changes the position and nothing else about the instance', () => {
    // The op carries a position; the rotation is the VOB's own and is not the
    // op's to touch.
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({
        count: 1,
        matrices: new Float32Array([1, 2, 3, 10, 4, 5, 6, 20, 7, 8, 9, 30]).buffer,
        vobIds: new Uint32Array([7]).buffer,
      })],
      stats: {} as never,
    });

    scene.moveVob(7, [-1, -2, -3]);

    const mesh = scene.root.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    expect([...matrix.elements]).toEqual([1, 4, 7, 0, 2, 5, 8, 0, 3, 6, 9, 0, -1, -2, -3, 1]);
  });

  test('the position is ZenGin space, unconverted — the root is still the only conversion', () => {
    // An op's coordinates are centimetres in ZenGin handedness, exactly as the
    // binding takes them. Converting here would be a second conversion, and the
    // instance would land somewhere the property grid does not agree with.
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual({ count: 1, vobIds: new Uint32Array([4]).buffer })], stats: {} as never });

    scene.moveVob(4, [1000, 0, 0]);

    const mesh = scene.root.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBe(1000);
  });

  test('a moved VOB takes its bounding sphere with it, or the frustum culls it away', () => {
    // InstancedMesh culls by a bounding sphere computed from the instances it
    // had when it was built. Dragging a VOB out of that sphere and leaving the
    // sphere behind makes it vanish at certain camera angles — and only at
    // certain camera angles, which is the worst way to find out.
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual({ count: 1, vobIds: new Uint32Array([4]).buffer })], stats: {} as never });
    const mesh = scene.root.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const before = mesh.boundingSphere!.clone();

    scene.moveVob(4, [100000, 0, 0]);

    expect(mesh.boundingSphere!.center.distanceTo(before.center)).toBeGreaterThan(1000);
  });

  test('moving a VOB that is not drawn changes nothing and says so', () => {
    // 23,288 VOBs are enumerated and 12,463 are placed: a decal, a particle
    // effect or a level compo has no instance to move, and the property grid
    // can still select one.
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });

    expect(scene.moveVob(4242, [1, 2, 3])).toBe(false);
  });

  test('where a VOB is drawn can be read back, so a gizmo can be put on it', () => {
    // The viewport has no access to the VOB index — it is handed payloads, not
    // the world — so the scene is what it asks where the selected VOB is.
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({
        count: 1,
        matrices: new Float32Array([1, 2, 3, 10, 4, 5, 6, 20, 7, 8, 9, 30]).buffer,
        vobIds: new Uint32Array([7]).buffer,
      })],
      stats: {} as never,
    });

    expect(scene.positionOf(7)).toEqual([10, 20, 30]);
    scene.moveVob(7, [40, 50, 60]);
    expect(scene.positionOf(7)).toEqual([40, 50, 60]);
    // A VOB with no instance has no position to report, and null is not [0,0,0]
    // — the middle of the world is a real place for a VOB to be.
    expect(scene.positionOf(4242)).toBeNull();
  });

  // ── rotation (level-editor.md §7) ───────────────────────────────────────
  //
  // A rotation writes the instance's 3x3 and must not touch its position: the
  // two live in the same Matrix4, and a careless `set` writes both.

  test('rotating a VOB writes the matrix row-major and leaves the position alone', () => {
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({
        count: 1,
        matrices: new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]).buffer,
        vobIds: new Uint32Array([7]).buffer,
      })],
      stats: {} as never,
    });

    // A quarter turn about Y: asymmetric, so a transpose shows.
    expect(scene.rotateVob(7, [0, 0, 1, 0, 1, 0, -1, 0, 0])).toBe(true);

    const mesh = scene.root.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    // Column-major storage of the row-major matrix above, with the position
    // untouched in the fourth column.
    expect([...matrix.elements]).toEqual([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 10, 20, 30, 1]);
  });

  test('a rotated VOB takes its bounding sphere with it', () => {
    // Same reason as a move: InstancedMesh culls by the sphere it was built
    // with, and a long visual turned end-on sweeps well outside it.
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({
        count: 1,
        matrices: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]).buffer,
        vobIds: new Uint32Array([4]).buffer,
      })],
      stats: {} as never,
    });
    const mesh = scene.root.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const before = mesh.boundingSphere!.center.clone();

    scene.rotateVob(4, [0, 0, 1, 0, 1, 0, -1, 0, 0]);

    expect(mesh.boundingSphere!.center.distanceTo(before)).toBeGreaterThan(1);
  });

  test('rotating a VOB that is not drawn changes nothing and says so', () => {
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });
    expect(scene.rotateVob(4242, [1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(false);
  });

  test('a VOB reports the visual bounds a rotation refits its bbox from', () => {
    // The bbox a retail world stores is the tight world AABB of the visual
    // placed by the VOB's transform, so an op that turns a VOB needs the
    // visual's own bounds — and the scene is where the renderer can reach them.
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({ bounds: [-1, -2, -3, 4, 5, 6] })],
      stats: {} as never,
    });

    expect(scene.boundsOf(9)).toEqual([-1, -2, -3, 4, 5, 6]);
    // Not [0,0,0,0,0,0]: a VOB with no instance has no visual bounds, and an
    // empty box would refit a real bbox down to a point.
    expect(scene.boundsOf(4242)).toBeNull();
  });

  test('a VOB reports the matrix a turn composes onto', () => {
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({
        count: 1,
        matrices: new Float32Array([0, 0, 1, 10, 0, 1, 0, 20, -1, 0, 0, 30]).buffer,
        vobIds: new Uint32Array([7]).buffer,
      })],
      stats: {} as never,
    });

    expect(scene.rotationOf(7)).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
    expect(scene.rotationOf(4242)).toBeNull();
  });

  test('a selection anchors the gizmo on the last VOB in it that is actually drawn', () => {
    // One gizmo drives a whole selection, and it has to sit somewhere. The last
    // one selected is the one the user just clicked — but a selection may hold
    // VOBs with no instance at all, and anchoring on one of those would detach
    // the gizmo from a selection that has perfectly drawable VOBs in it.
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });

    // Both drawn, and at different places: the order is the whole answer here,
    // and a scan from either end agrees whenever only one of them is drawn.
    expect(scene.anchorOf([7, 9])).toEqual([40, 50, 60]);
    expect(scene.anchorOf([9, 7])).toEqual([10, 20, 30]);
    // A VOB with no instance is stepped over rather than detaching the gizmo.
    expect(scene.anchorOf([9, 4242])).toEqual([40, 50, 60]);
    // Nothing drawn, nothing to attach to — and an empty selection is not an
    // error, it is what "deselect" leaves behind.
    expect(scene.anchorOf([4242])).toBeNull();
    expect(scene.anchorOf([])).toBeNull();
  });

  test('a selection also reports its centre, which is what a translate gizmo stands on', () => {
    // §16.24 2: the gizmo sat on the last VOB picked, so a multi-selection put
    // the handles on its edge. The centre is the translate answer; `anchorOf`
    // stays the rotate one, because `rotateVobs` turns each VOB about its own
    // origin and a gizmo at the centroid would show a pivot the op does not use.
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });

    expect(scene.centroidOf([7, 9])).toEqual([25, 35, 45]);
    // Order cannot matter, which is the whole difference from `anchorOf`.
    expect(scene.centroidOf([9, 7])).toEqual([25, 35, 45]);
    // A VOB with no instance has no position to average in — counting it as an
    // origin would drag the centre towards [0, 0, 0].
    expect(scene.centroidOf([9, 4242])).toEqual([40, 50, 60]);
    expect(scene.centroidOf([4242])).toBeNull();
    expect(scene.centroidOf([])).toBeNull();
  });

  test('the selected VOBs carry a per-instance flag, and only they do', () => {
    // §16.24 1: the silhouette darkening is deliberately never a selection
    // state, so a VOB whose gizmo is off screen read as unselected. The cheap
    // emphasis is the one hiding already uses — a per-instance attribute the
    // VOB shader carries — not a second InstancedMesh per visual, which is 724
    // more draw calls (render-performance.md).
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });
    const mesh = scene.instancedMeshes[0];

    scene.setSelectedVobs([9]);

    const selected = mesh.geometry.getAttribute('instanceSelected');
    // vobIds are [7, 9]: the second instance, and only it.
    expect([...(selected.array as Float32Array)]).toEqual([0, 1]);
    expect(selected.version).toBe(1);
    // Nothing about the pose moves — the flag is beside the matrix, exactly as
    // `instanceHidden` is, so the gizmo and every op still read the same place.
    expect(scene.positionOf(9)).toEqual([40, 50, 60]);
  });

  test('deselecting clears the flag it set, and touches no other mesh', () => {
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual(), visual({
        name: 'CRATE.3DS',
        count: 1,
        matrices: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]).buffer,
        vobIds: new Uint32Array([11]).buffer,
      })],
      stats: {} as never,
    });
    const [barrels, crate] = scene.instancedMeshes;

    scene.setSelectedVobs([9]);
    scene.setSelectedVobs([]);

    expect([...(barrels.geometry.getAttribute('instanceSelected').array as Float32Array)])
      .toEqual([0, 0]);
    expect(barrels.geometry.getAttribute('instanceSelected').version).toBe(2);
    // The crate never held a selected instance, so nothing about it was
    // re-uploaded — a whole-scene rewrite per click is 724 attribute uploads.
    expect(crate.geometry.getAttribute('instanceSelected').version).toBe(0);
  });

  test('every mesh a visual was split into takes the same selected flag', () => {
    // The hazard `moveVob` and `setHiddenVobs` already carry: one VOB is an
    // instance in every mesh its visual was split into, and marking it in one
    // of them outlines half a prop.
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({ groups: [group({ lights: null }), group({ texture: 'NW_STONE.TGA', lights: null })] })],
      stats: {} as never,
    });

    scene.setSelectedVobs([7]);

    expect(scene.instancedMeshes).toHaveLength(2);
    for (const mesh of scene.instancedMeshes) {
      expect([...(mesh.geometry.getAttribute('instanceSelected').array as Float32Array)])
        .toEqual([1, 0]);
    }
  });

  test('the VOB shader reads the selected flag, and the world mesh never declares one', () => {
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });
    scene.setWorldMesh({ groups: [group()], bbox: [] });

    const vob = compile(scene.instancedMeshes[0].material as THREE.MeshBasicMaterial);
    expect(vob.vertexShader).toContain('attribute float instanceSelected;');
    // Carried to the fragment stage: the emphasis is a colour, not a vertex
    // move — a selected VOB must stay exactly where the op would put it.
    expect(vob.vertexShader).toContain('vVobSelected = instanceSelected;');
    expect(vob.fragmentShader).toContain('vVobSelected');

    const world = compile(scene.worldMeshes[0].material as THREE.MeshBasicMaterial);
    expect(world.vertexShader).not.toContain('instanceSelected');
    expect(world.fragmentShader).not.toContain('vVobSelected');
  });

  test('VOB materials write the outline mask and the world mesh writes an empty one', () => {
    // "A VOB is hard to tell from the world mesh" (2026-08-27), and the rim
    // term that answered it drew nothing a human could see (§16.12): a flat
    // face has no facing gradient and a billboard's silhouette is its texture's
    // cutout. So the outline is no longer shaded — it is a screen-space line
    // drawn by `VobOutline` wherever a *mask* changes, and this is the mask's
    // producer: a second colour attachment every VOB fragment writes and every
    // world-mesh fragment clears.
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group()], bbox: [] });
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });

    const world = (scene.root.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const vob = scene.instancedMeshes[0].material as THREE.MeshBasicMaterial;

    // The two programs must not share a cache key, or one compiled shader is
    // handed to both and whichever material compiled first decides.
    expect(vob.customProgramCacheKey()).not.toBe(world.customProgramCacheKey());

    // Nothing extra is drawn: one world mesh, one InstancedMesh, no second
    // mesh per visual. The mask rides the draw that exists.
    expect(scene.root.children).toHaveLength(2);

    const vobShader = compile(vob);
    // The mask has three channels: "a VOB is here", a key that tells two
    // touching VOBs apart (hashed from the instance's own origin, so it costs
    // no attribute), and the selection flag — so the line between a selected
    // VOB and its neighbour is drawn in the selection colour.
    expect(vobShader.fragmentShader).toContain('layout(location = 1) out highp vec4 vobMask;');
    expect(vobShader.vertexShader).toContain('instanceMatrix[ 3 ].xyz');
    expect(vobShader.vertexShader).toMatch(/vVobKey = /);
    expect(vobShader.fragmentShader).toMatch(/vobMask = vec4\( 1\.0, vVobKey, vVobSelected, 1\.0 \);/);
    expect(vobShader.fragmentShader).toContain('#include <opaque_fragment>');
    // And no rim: the facing term is gone with the mechanism it belonged to.
    expect(vobShader.fragmentShader).not.toContain('vobFacing');
    expect(vobShader.vertexShader).not.toContain('vVobNormal');

    // The world mesh declares the same output and writes nothing into it — an
    // attachment a program never writes is undefined, not zero, and a wall
    // that left garbage in the mask would grow an outline.
    const worldShader = compile(world);
    expect(worldShader.vertexShader).toBe(THREE.ShaderLib.basic.vertexShader);
    expect(worldShader.fragmentShader).toContain('layout(location = 1) out highp vec4 vobMask;');
    expect(worldShader.fragmentShader).toMatch(/vobMask = vec4\( 0\.0 \);/);
    expect(worldShader.fragmentShader).not.toContain('vVobKey');
  });

  test('a blended VOB leaves the mask alone, so a flame quad gets no rectangle', () => {
    // A blended surface blends *every* attachment with its own alpha, so the
    // mask it writes has to be all zero — then the blend leaves what was there.
    // The choice is a define, not a second hook: defines are part of the
    // program cache key, so the two variants stay two programs.
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({ groups: [group({ alphaFunc: 2, lights: null })] })],
      stats: {} as never,
    });
    const blended = scene.instancedMeshes[0].material as THREE.MeshBasicMaterial;
    expect(blended.transparent).toBe(true);
    expect(blended.defines).toEqual({ VOB_MASK_BLENDED: '' });
    const shader = compile(blended);
    expect(shader.fragmentShader).toMatch(/#ifdef VOB_MASK_BLENDED\s+vobMask = vec4\( 0\.0 \);\s+#else/);

    const opaque = new WorldScene();
    opaque.setInstancedVisuals({ visuals: [visual()], stats: {} as never });
    expect((opaque.instancedMeshes[0].material as THREE.MeshBasicMaterial).defines).toBeUndefined();
  });

  test('the world and its VOBs draw on their own layer, so the outline pass can draw them alone', () => {
    // `VobOutline` renders the world into the masked target with the camera on
    // this layer, composites, and only then draws everything else — gizmo,
    // waynet, markers — on top with the world's depth restored. An object left
    // on layer 0 in this scene would be drawn twice; one on this layer that is
    // not world geometry would be drawn under the line.
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group()], bbox: [] });
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });

    const worldLayer = new THREE.Layers();
    worldLayer.set(WORLD_LAYER);
    expect(WORLD_LAYER).not.toBe(0);
    for (const mesh of [...scene.worldMeshes, ...scene.instancedMeshes]) {
      expect(mesh.layers.mask).toBe(worldLayer.mask);
    }
  });

  test('brightness is one shared uniform that lifts the picture and nothing else', () => {
    // "Interiors are too dark" (2026-08-27). ZenGin's light is baked into the
    // vertex colours and MeshBasicMaterial has nothing to relight, so the fix
    // is an exposure multiply on the finished fragment — a viewport setting.
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group()], bbox: [] });
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });

    const worldMesh = scene.root.children[0] as THREE.Mesh;
    const world = worldMesh.material as THREE.MeshBasicMaterial;
    const vob = scene.instancedMeshes[0].material as THREE.MeshBasicMaterial;

    const worldShader = compile(world);
    const vobShader = compile(vob);

    // An interior's walls are world mesh, so a control the world mesh did not
    // take would leave everything that is actually dark exactly as dark.
    expect(worldShader.fragmentShader).toContain('outgoingLight *= uExposure;');
    expect(vobShader.fragmentShader).toContain('outgoingLight *= uExposure;');
    expect(worldShader.fragmentShader).toContain('uniform float uExposure;');
    // After the selection tint, not instead of it: the two multiply.
    expect(vobShader.fragmentShader.indexOf('outgoingLight = mix('))
      .toBeLessThan(vobShader.fragmentShader.indexOf('outgoingLight *= uExposure;'));

    // ONE uniform object for the whole scene, so a slider drag is one
    // assignment rather than a walk over every material in the world.
    expect(worldShader.uniforms.uExposure).toBe(vobShader.uniforms.uExposure);
    expect(worldShader.uniforms.uExposure.value).toBe(DEFAULT_EXPOSURE);

    // And it is written, not recompiled: `Material.version` is what a
    // `needsUpdate` would bump, and a recompile per pointer move is the cost
    // this uniform exists to avoid.
    const versions = [world.version, vob.version];
    const baked = (worldMesh.geometry.getAttribute('color').array as Float32Array).slice();

    scene.setExposure(2.5);

    expect(worldShader.uniforms.uExposure.value).toBe(2.5);
    expect(vobShader.uniforms.uExposure.value).toBe(2.5);
    expect([world.version, vob.version]).toEqual(versions);
    // Nothing about the world moved: the baked vertex colours are the world's
    // own data, and this changes what is drawn from them, not them.
    expect(worldMesh.geometry.getAttribute('color').array).toEqual(baked);
  });
  test('a hidden VOB is dropped in the vertex shader, and keeps its transform', () => {
    // Spacer's per-class show/hide (§16.16). A VOB is an instance inside a mesh
    // shared with every other VOB of the same visual, so hiding one cannot be
    // `mesh.visible` — and it must not be a zero-scale matrix either: the
    // instance matrix is where the VOB's position and rotation are *read back*
    // from, so collapsing it would make a hidden VOB's gizmo report the origin.
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });
    const mesh = scene.instancedMeshes[0];
    const before = scene.positionOf(9);

    scene.setHiddenVobs(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));

    const hidden = mesh.geometry.getAttribute('instanceHidden');
    // vobIds are [7, 9]: the second instance, and only it.
    expect([...(hidden.array as Float32Array)]).toEqual([0, 1]);
    // `needsUpdate` is write-only in three; the version it bumps is what the
    // renderer actually re-uploads on, and a flag written without it is inert.
    expect(hidden.version).toBe(1);
    expect(scene.positionOf(9)).toEqual(before);
    expect(scene.rotationOf(9)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    // And the shader actually reads it — the flag is inert without the branch.
    const vobShader = compile(mesh.material as THREE.MeshBasicMaterial);
    expect(vobShader.vertexShader).toContain('attribute float instanceHidden;');
    expect(vobShader.vertexShader).toMatch(/instanceHidden > 0\.5/);
    // The world mesh has no instances to hide, and must not declare one.
    scene.setWorldMesh({ groups: [group()], bbox: [] });
    const world = compile(scene.worldMeshes[0].material as THREE.MeshBasicMaterial);
    expect(world.vertexShader).not.toContain('instanceHidden');
  });

  test('every mesh a visual was split into takes the same hidden flag', () => {
    // A visual with two draw groups puts one VOB in two meshes — the hazard
    // `moveVob` already carries. Hiding it in one of them draws half a prop.
    const scene = new WorldScene();
    scene.setInstancedVisuals({
      visuals: [visual({ groups: [group({ lights: null }), group({ texture: 'NW_STONE.TGA', lights: null })] })],
      stats: {} as never,
    });

    scene.setHiddenVobs(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0]));

    expect(scene.instancedMeshes).toHaveLength(2);
    for (const mesh of scene.instancedMeshes) {
      expect([...(mesh.geometry.getAttribute('instanceHidden').array as Float32Array)]).toEqual([1, 0]);
    }
  });

  test('showing everything again clears the flag, rather than leaving the last set', () => {
    const scene = new WorldScene();
    scene.setInstancedVisuals({ visuals: [visual()], stats: {} as never });

    scene.setHiddenVobs(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 1]));
    scene.setHiddenVobs(null);

    const hidden = scene.instancedMeshes[0].geometry.getAttribute('instanceHidden');
    expect([...(hidden.array as Float32Array)]).toEqual([0, 0]);
    expect(hidden.version).toBe(2);
  });
});
