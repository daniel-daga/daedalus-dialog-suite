/**
 * Scene-graph assertions for the Phase 1a viewport (level-editor.md §11 —
 * "viewport correctness via scene-graph assertions where DOM assertions can't
 * reach"). `WorldScene` deliberately builds the Three.js graph without a
 * WebGLRenderer, so everything the spike had to verify by looking at a picture
 * is checkable here instead:
 *
 *   - the whole scene hangs under ONE mirrored node, so winding and units are
 *     settled in one place and no material reaches for DoubleSide
 *   - VOBs sharing a visual are one InstancedMesh, not one Mesh each
 *   - an instance can be traced back to the VOB it came from
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { ROOT_MATRIX } from 'zen-world';
import type { DrawGroup, InstancedVisual } from '../src/shared/worldTypes';
import { WorldScene } from '../src/renderer/world/WorldScene';

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
    ...overrides,
  };
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

  test('materials are single-sided, because the mirror already flipped winding', () => {
    // side: DoubleSide would hide a wrong winding decision instead of proving
    // the right one — explicitly ruled out in §7.
    const scene = new WorldScene();
    scene.setWorldMesh({ groups: [group()], bbox: [0, 0, 0, 1, 1, 1] });
    const mesh = scene.root.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.Material).side).toBe(THREE.FrontSide);
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
});
