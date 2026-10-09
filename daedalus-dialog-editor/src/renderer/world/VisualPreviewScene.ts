import * as THREE from 'three';
import { ROOT_MATRIX } from 'zen-world';
import type { DecodedTexture, VisualScene } from '../../shared/worldTypes';
import { ALPHA_TEST, dataTexture, drawGroupGeometry } from './WorldScene';

// One visual on its own, for the Assets panel (level-editor.md §16.26 row 1).
//
// The geometry is `WorldScene`'s: the same `drawGroupGeometry` under the same
// ROOT_MATRIX node, so a crate here is the crate the viewport draws — the
// centimetre-to-metre scale, the mirror and the winding reversal are all settled
// in `coords` and not re-decided by a second renderer. What differs is the
// material. A proto mesh carries no baked light word, and `WorldScene` draws it
// with a `MeshBasicMaterial` because the world around it supplies the shading
// cue; a visual alone on a dark canvas has no such cue, so it is Lambert-lit by
// a hemisphere and a key light — flat, but a shape, not a silhouette.
//
// Deliberately free of React and of WebGLRenderer, like `WorldScene`, so the
// graph is checkable in jsdom.

export interface VisualPreview {
  scene: THREE.Scene;
  /** The node carrying ROOT_MATRIX; every mesh hangs under it. */
  root: THREE.Group;
  meshes: THREE.Mesh[];
  /** Texture names the materials name but have no pixels for yet. */
  pendingTextureNames(): string[];
  /** Put decoded pixels on every material that names this texture. */
  applyTexture(decoded: DecodedTexture): void;
  dispose(): void;
}

export function buildVisualPreview(visual: VisualScene): VisualPreview {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.matrix.fromArray(ROOT_MATRIX);
  root.matrixWorldNeedsUpdate = true;
  scene.add(root);

  // Physically-sized intensities (three r155+): a hemisphere for the ambient
  // fill and one key light so a face's orientation reads.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.5));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(1, 2, 1.5);
  scene.add(key);

  const meshes: THREE.Mesh[] = [];
  const materials: THREE.MeshLambertMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const textures = new Map<string, { texture: THREE.Texture | null; materials: THREE.MeshLambertMaterial[] }>();

  for (const group of visual.groups) {
    const material = new THREE.MeshLambertMaterial({ side: THREE.FrontSide });
    if (group.texture === '') {
      material.color.setRGB(group.color[0] / 255, group.color[1] / 255, group.color[2] / 255, THREE.SRGBColorSpace);
    } else {
      const name = group.texture.toUpperCase();
      let slot = textures.get(name);
      if (slot === undefined) {
        slot = { texture: null, materials: [] };
        textures.set(name, slot);
      }
      slot.materials.push(material);
    }
    // The world's own alpha rules: 1 is a cut-out, 2 blends, 3 adds.
    if (group.alphaFunc === 1) material.alphaTest = ALPHA_TEST;
    if (group.alphaFunc === 2 || group.alphaFunc === 3) {
      material.transparent = true;
      material.depthWrite = false;
      if (group.alphaFunc === 3) material.blending = THREE.AdditiveBlending;
    }

    const geometry = drawGroupGeometry(group);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    meshes.push(mesh);
    materials.push(material);
    geometries.push(geometry);
  }

  return {
    scene,
    root,
    meshes,
    pendingTextureNames() {
      const pending: string[] = [];
      for (const [name, slot] of textures) if (slot.texture === null) pending.push(name);
      return pending;
    },
    applyTexture(decoded) {
      const slot = textures.get(decoded.name.toUpperCase());
      if (!slot || slot.texture !== null) return;
      const texture = dataTexture(decoded);
      slot.texture = texture;
      for (const material of slot.materials) {
        material.map = texture;
        material.needsUpdate = true;
      }
    },
    dispose() {
      for (const slot of textures.values()) slot.texture?.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
      root.clear();
    },
  };
}

/**
 * Point a camera at a visual's bounds and back it off far enough to see the
 * whole box, returning the orbit target. Bounds are ZenGin space, so the box
 * goes through ROOT_MATRIX first — the X mirror puts a box at +200 cm at -2 m.
 */
export function frameVisual(camera: THREE.PerspectiveCamera, bounds: readonly number[]): THREE.Vector3 {
  const box = new THREE.Box3(
    new THREE.Vector3(bounds[0], bounds[1], bounds[2]),
    new THREE.Vector3(bounds[3], bounds[4], bounds[5]),
  ).applyMatrix4(new THREE.Matrix4().fromArray(ROOT_MATRIX));

  const target = box.getCenter(new THREE.Vector3());
  // A flat visual (a decal-like quad, a single triangle) has a zero extent on
  // one axis and may have on all three; a floor on the radius keeps the camera
  // off the target and the near plane finite.
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.05);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.2;

  camera.position.copy(target).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance));
  camera.near = Math.max(distance / 1000, 0.001);
  camera.far = distance + radius * 4;
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return target;
}
