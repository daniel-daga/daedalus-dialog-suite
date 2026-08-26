import * as THREE from 'three';
import { ROOT_MATRIX } from 'zen-world';
import type { DrawGroup, InstancedPayload, WorldMeshPayload, DecodedTexture } from '../../shared/worldTypes';

// The Three.js projection of a world (level-editor.md §7: "the renderer is a
// projection, never the model"). Deliberately free of React and of
// WebGLRenderer: it builds a scene graph out of the payloads the worker sent,
// which is what makes the decisions in it testable without a GPU.
//
// The whole graph hangs under ONE node carrying `coords`' ROOT_MATRIX. That
// node is the entire ZenGin -> Three.js conversion: centimetres to metres, and
// the mirror that both flips handedness and settles triangle winding. Because
// of it every buffer below stays exactly as the binding emitted it — positions
// unconverted, indices in stored order — and every material stays FrontSide.

/** sRGB -> linear, for the baked zCOLOR word. 256 entries beats a pow per vertex. */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** AlphaFunction: 1 NONE (cut-out), 2 BLEND, 3 ADD; anything else is opaque. */
const ALPHA_TEST = 0.5;

interface TextureSlot {
  texture: THREE.Texture | null;
  materials: THREE.MeshBasicMaterial[];
}

export class WorldScene {
  /** The one converted node. Everything else is a descendant of it. */
  readonly root = new THREE.Group();

  /** Meshes worth raycasting: the world mesh, which a BVH answers in 0.2 ms.
   *  Instanced VOBs are GPU ID-picked instead — a CPU raycast across them
   *  costs 14.2 ms on its own and blows the one-frame budget (§3). */
  readonly worldMeshes: THREE.Mesh[] = [];
  readonly instancedMeshes: THREE.InstancedMesh[] = [];

  private textures = new Map<string, TextureSlot>();
  private instanceVobIds = new WeakMap<THREE.InstancedMesh, Uint32Array>();
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  constructor() {
    this.root.matrixAutoUpdate = false;
    this.root.matrix.fromArray([...ROOT_MATRIX]);
    this.root.matrixWorldNeedsUpdate = true;
  }

  setWorldMesh(payload: WorldMeshPayload): void {
    for (const group of payload.groups) {
      const mesh = new THREE.Mesh(this.geometry(group), this.material(group));
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      this.worldMeshes.push(mesh);
    }
  }

  setInstancedVisuals(payload: InstancedPayload): void {
    const matrix = new THREE.Matrix4();

    for (const visual of payload.visuals) {
      const matrices = new Float32Array(visual.matrices);
      const vobIds = new Uint32Array(visual.vobIds);

      for (const group of visual.groups) {
        const mesh = new THREE.InstancedMesh(
          this.geometry(group), this.material(group), visual.count,
        );
        for (let i = 0; i < visual.count; i++) {
          const m = i * 12;
          // Matrix4.set takes row-major arguments, which is the order the
          // payload uses — rotation rows with the position as a fourth column.
          matrix.set(
            matrices[m], matrices[m + 1], matrices[m + 2], matrices[m + 3],
            matrices[m + 4], matrices[m + 5], matrices[m + 6], matrices[m + 7],
            matrices[m + 8], matrices[m + 9], matrices[m + 10], matrices[m + 11],
            0, 0, 0, 1,
          );
          mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.matrixAutoUpdate = false;
        mesh.computeBoundingSphere();

        this.instanceVobIds.set(mesh, vobIds);
        this.root.add(mesh);
        this.instancedMeshes.push(mesh);
      }
    }
  }

  /** The VOB an instance came from — a pick returns nothing else that identifies it. */
  resolveInstance(mesh: THREE.InstancedMesh, instanceId: number): number | null {
    const vobIds = this.instanceVobIds.get(mesh);
    if (!vobIds || instanceId < 0 || instanceId >= vobIds.length) return null;
    return vobIds[instanceId];
  }

  /** Texture names the scene has materials for but no pixels yet. */
  pendingTextureNames(): string[] {
    const pending: string[] = [];
    for (const [name, slot] of this.textures) {
      if (slot.texture === null) pending.push(name);
    }
    return pending;
  }

  applyTexture(decoded: DecodedTexture): void {
    const slot = this.textures.get(decoded.name.toUpperCase());
    if (!slot || slot.texture !== null) return;

    const texture = new THREE.DataTexture(
      new Uint8Array(decoded.rgba), decoded.width, decoded.height,
    );
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.flipY = true;
    texture.needsUpdate = true;

    slot.texture = texture;
    for (const material of slot.materials) {
      material.map = texture;
      // An untextured material carried its colour; a textured one must not
      // multiply the texture by it.
      material.color.setRGB(1, 1, 1);
      material.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const slot of this.textures.values()) slot.texture?.dispose();

    this.geometries = [];
    this.materials = [];
    this.textures.clear();
    this.worldMeshes.length = 0;
    this.instancedMeshes.length = 0;
    this.root.clear();
  }

  // Whether a group is lit is not a caller's choice: `mergeChunks` emits
  // `lights: null` exactly for the proto-mesh chunks that have no baked ZenGin
  // light word, so the buffer's presence already says it.
  private geometry(group: DrawGroup): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(group.positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(group.normals), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(group.uvs), 2));
    if (group.lights !== null) {
      geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors(new Uint32Array(group.lights)), 3));
    }
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(group.indices), 1));
    geometry.computeBoundingSphere();

    this.geometries.push(geometry);
    return geometry;
  }

  private material(group: DrawGroup): THREE.MeshBasicMaterial {
    // MeshBasicMaterial, not a lit one: ZenGin's lighting is baked into the
    // vertex colours and there is nothing dynamic in an editor viewport to
    // relight it with.
    const material = new THREE.MeshBasicMaterial({
      vertexColors: group.lights !== null,
      side: THREE.FrontSide,
    });

    if (group.texture === '') {
      material.color.setRGB(
        SRGB_TO_LINEAR[group.color[0]], SRGB_TO_LINEAR[group.color[1]], SRGB_TO_LINEAR[group.color[2]],
      );
    } else {
      const name = group.texture.toUpperCase();
      let slot = this.textures.get(name);
      if (slot === undefined) {
        slot = { texture: null, materials: [] };
        this.textures.set(name, slot);
      }
      slot.materials.push(material);
      material.map = slot.texture;
    }

    if (group.alphaFunc === 1) material.alphaTest = ALPHA_TEST;
    if (group.alphaFunc === 2 || group.alphaFunc === 3) {
      material.transparent = true;
      material.depthWrite = false;
      if (group.alphaFunc === 3) material.blending = THREE.AdditiveBlending;
    }

    this.materials.push(material);
    return material;
  }
}

/** The baked ZenGin light word, decoded here rather than in the binding: the
 *  channel order is a rendering question. zCOLOR is a DWORD 0xAARRGGBB, and
 *  the colour buffer Three.js wants is linear. */
function vertexColors(words: Uint32Array): Float32Array {
  const out = new Float32Array(words.length * 3);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    out[i * 3] = SRGB_TO_LINEAR[(word >>> 16) & 0xff];
    out[i * 3 + 1] = SRGB_TO_LINEAR[(word >>> 8) & 0xff];
    out[i * 3 + 2] = SRGB_TO_LINEAR[word & 0xff];
  }
  return out;
}
