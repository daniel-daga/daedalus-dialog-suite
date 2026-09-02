/**
 * The asset preview's own little scene (level-editor.md §16.26 row 1): one
 * visual, unplaced, framed for a camera. Built without a WebGLRenderer, exactly
 * as `WorldScene` is, so the decisions are checkable here:
 *
 *   - it hangs under the same ROOT_MATRIX node the world does, and its index
 *     order goes through the same boundary, so a crate in the preview is the
 *     crate in the viewport and no material reaches for DoubleSide
 *   - the geometry is the world scene's own draw-group geometry, not a copy
 *   - the camera frames the visual's bounds, in Three.js space
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { ROOT_MATRIX } from 'zen-world';
import type { DrawGroup, VisualScene } from '../src/shared/worldTypes';
import { drawGroupGeometry } from '../src/renderer/world/WorldScene';
import { buildVisualPreview, frameVisual } from '../src/renderer/world/VisualPreviewScene';

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
    lights: null,
    ...overrides,
  };
}

function visual(overrides: Partial<VisualScene> = {}): VisualScene {
  return {
    name: 'NW_CRATE.MRM',
    source: 'NW_CRATE.MRM',
    groups: [group()],
    bounds: [0, 0, 0, 100, 100, 0],
    triangleCount: 1,
    ...overrides,
  };
}

describe('buildVisualPreview', () => {
  it("hangs the visual under the world's own root matrix, one mesh per draw group", () => {
    const preview = buildVisualPreview(visual({ groups: [group(), group({ texture: '' })] }));

    expect(preview.root.matrix.toArray()).toEqual([...ROOT_MATRIX]);
    expect(preview.meshes).toHaveLength(2);
    for (const mesh of preview.meshes) expect(preview.root.children).toContain(mesh);
  });

  it('builds the geometry the world scene builds — winding reversed at the same boundary', () => {
    // Not "geometry built the same way": the same function. A preview whose
    // triangles face the other way from the viewport's is a preview that lies.
    const g = group({ indices: new Uint32Array([0, 1, 2]).buffer });
    const preview = buildVisualPreview(visual({ groups: [g] }));
    const expected = drawGroupGeometry(g);

    expect(Array.from(preview.meshes[0].geometry.index!.array)).toEqual(Array.from(expected.index!.array));
    expect(Array.from(preview.meshes[0].geometry.index!.array)).toEqual([0, 2, 1]);
    expect((preview.meshes[0].material as THREE.Material).side).toBe(THREE.FrontSide);
  });

  it('is lit, since a proto mesh carries no baked light word to show its shape with', () => {
    const preview = buildVisualPreview(visual());
    expect(preview.scene.children.some((o) => (o as THREE.Light).isLight)).toBe(true);
    expect((preview.meshes[0].material as THREE.MeshLambertMaterial).isMeshLambertMaterial).toBe(true);
  });

  it("carries an untextured group's colour and leaves a textured one white for its map", () => {
    const preview = buildVisualPreview(visual({
      groups: [group({ texture: '', color: [255, 0, 0, 255] }), group({ texture: 'NW_WOOD.TGA' })],
    }));
    const [plain, textured] = preview.meshes.map((m) => m.material as THREE.MeshLambertMaterial);
    expect(plain.color.r).toBeCloseTo(1);
    expect(plain.color.g).toBeCloseTo(0);
    expect(textured.color.getHex()).toBe(0xffffff);
    expect(preview.pendingTextureNames()).toEqual(['NW_WOOD.TGA']);
  });

  it('applies a decoded texture to every material that names it', () => {
    const preview = buildVisualPreview(visual({
      groups: [group({ texture: 'NW_WOOD.TGA' }), group({ texture: 'nw_wood.tga', alphaFunc: 1 })],
    }));
    preview.applyTexture({ name: 'NW_WOOD.TGA', width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]).buffer });

    for (const mesh of preview.meshes) {
      expect((mesh.material as THREE.MeshLambertMaterial).map).not.toBeNull();
    }
    expect(preview.pendingTextureNames()).toEqual([]);
  });

  it('takes alpha the way the world does: cut-out tests, blend and add draw transparent', () => {
    const preview = buildVisualPreview(visual({
      groups: [group({ alphaFunc: 1 }), group({ alphaFunc: 2 }), group({ alphaFunc: 3 })],
    }));
    const [cutout, blend, add] = preview.meshes.map((m) => m.material as THREE.MeshLambertMaterial);
    expect(cutout.alphaTest).toBeGreaterThan(0);
    expect(blend.transparent).toBe(true);
    expect(add.blending).toBe(THREE.AdditiveBlending);
  });

  it('disposes what it made', () => {
    const preview = buildVisualPreview(visual());
    const geometry = preview.meshes[0].geometry;
    const disposed = jest.fn();
    geometry.addEventListener('dispose', disposed);
    preview.dispose();
    expect(disposed).toHaveBeenCalled();
    expect(preview.root.children).toHaveLength(0);
  });
});

describe('frameVisual', () => {
  it("aims the camera at the bounds' centre in Three.js space and backs off by their size", () => {
    // ZenGin centimetres, X mirrored: a box spanning 0..200 cm on X is
    // centred at -1 m on screen, not +1.
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    const target = frameVisual(camera, [0, 0, 0, 200, 100, 50]);

    expect(target.x).toBeCloseTo(-1);
    expect(target.y).toBeCloseTo(0.5);
    expect(target.z).toBeCloseTo(0.25);
    const distance = camera.position.distanceTo(target);
    // The box's half-diagonal is ~1.146 m; the camera stands further off than that.
    expect(distance).toBeGreaterThan(1.146);
    expect(camera.far).toBeGreaterThan(distance);
    expect(camera.near).toBeLessThan(distance);
    // Looking at the target: the camera's forward axis passes through it.
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const toTarget = target.clone().sub(camera.position).normalize();
    expect(forward.dot(toTarget)).toBeCloseTo(1);
  });

  it('still frames a flat visual, whose box has a zero extent', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    const target = frameVisual(camera, [0, 0, 0, 0, 0, 0]);
    expect(camera.position.distanceTo(target)).toBeGreaterThan(0);
    expect(Number.isFinite(camera.far)).toBe(true);
  });
});
