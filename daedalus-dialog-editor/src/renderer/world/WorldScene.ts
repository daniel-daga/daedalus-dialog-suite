import * as THREE from 'three';
import { ROOT_MATRIX, threeIndexOrder } from 'zen-world';
import type { DrawGroup, InstancedPayload, WorldMeshPayload, DecodedTexture } from '../../shared/worldTypes';

// The Three.js projection of a world (level-editor.md §7: "the renderer is a
// projection, never the model"). Deliberately free of React and of
// WebGLRenderer: it builds a scene graph out of the payloads the worker sent,
// which is what makes the decisions in it testable without a GPU.
//
// The whole graph hangs under ONE node carrying `coords`' ROOT_MATRIX:
// centimetres to metres, and the mirror that flips handedness. Because of it
// every position below stays exactly as the binding emitted it, unconverted.
// Triangle winding is the one thing that node cannot settle — Three.js cancels
// a negative determinant's effect on the front/back test — so index order goes
// through `coords`' `threeIndexOrder` on the way in, and every material stays
// FrontSide.

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
  /** The visual's own bounds, per mesh — what a rotation refits a bbox from.
   *  Against the mesh rather than against each VOB, because the scan for a VOB's
   *  instance already exists and a second per-VOB structure would be a second
   *  thing to keep correct across every op that adds or removes one. */
  private meshBounds = new WeakMap<THREE.InstancedMesh, readonly number[]>();
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
        this.meshBounds.set(mesh, visual.bounds);
        this.root.add(mesh);
        this.instancedMeshes.push(mesh);
      }
    }
  }

  /** The VOB an instance came from — a pick returns nothing else that identifies it. */
  /**
   * Move a VOB in the scene, in **ZenGin space** — an edit arriving from the op
   * path (level-editor.md §7), or the live preview of one being dragged.
   *
   * Two things make this less obvious than setting a matrix. A VOB is an
   * instance inside a mesh shared with every other VOB of the same visual, and
   * a visual with several draw groups puts that instance in several meshes — so
   * every one of them has to be written, or the VOB is drawn in two places at
   * once. And `InstancedMesh` culls by a bounding sphere computed from the
   * instances it was built with: dragging a VOB out of that sphere without
   * recomputing it makes the whole mesh vanish at some camera angles and not
   * others.
   *
   * The scan is deliberate rather than an index. It costs one pass over the
   * ~20k instance ids in the scene, it happens on a drag frame and not on a
   * render frame, and a permanent VOB -> instance map is a second structure to
   * keep correct across every future op that adds or removes one.
   *
   * @returns whether the VOB is drawn at all — 23,288 VOBs are enumerated on
   *   NewWorld and 12,463 placed, so a decal or a particle effect is selectable
   *   and has no instance to move.
   */
  moveVob(vob: number, position: readonly [number, number, number]): boolean {
    const matrix = new THREE.Matrix4();
    let moved = false;

    for (const mesh of this.instancedMeshes) {
      const vobIds = this.instanceVobIds.get(mesh);
      if (!vobIds) continue;

      let here = false;
      for (let i = vobIds.indexOf(vob); i !== -1; i = vobIds.indexOf(vob, i + 1)) {
        mesh.getMatrixAt(i, matrix);
        matrix.setPosition(position[0], position[1], position[2]);
        mesh.setMatrixAt(i, matrix);
        here = true;
      }
      if (!here) continue;

      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      moved = true;
    }

    return moved;
  }

  /**
   * Turn a VOB in the scene: its 3x3, **row-major**, in ZenGin space.
   *
   * The same two hazards as `moveVob` — every mesh the visual was split into,
   * and the bounding sphere the mesh culls by — plus one of its own: the
   * rotation and the position share a `Matrix4`, so this writes the nine
   * elements of the basis and leaves the fourth column exactly as it was. A
   * rotation is not a move, and a VOB that quietly jumped to the origin when it
   * was turned would look like a gizmo bug.
   *
   * @returns whether the VOB is drawn at all.
   */
  rotateVob(vob: number, rotation: readonly number[]): boolean {
    const matrix = new THREE.Matrix4();
    let turned = false;

    for (const mesh of this.instancedMeshes) {
      const vobIds = this.instanceVobIds.get(mesh);
      if (!vobIds) continue;

      let here = false;
      for (let i = vobIds.indexOf(vob); i !== -1; i = vobIds.indexOf(vob, i + 1)) {
        mesh.getMatrixAt(i, matrix);
        // `elements` is column-major: element[row][col] is elements[col*4+row].
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            matrix.elements[col * 4 + row] = rotation[row * 3 + col];
          }
        }
        mesh.setMatrixAt(i, matrix);
        here = true;
      }
      if (!here) continue;

      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      turned = true;
    }

    return turned;
  }

  /**
   * The visual's own bounds for a VOB, in the visual's own space — or null when
   * it is not drawn.
   *
   * A rotation refits the VOB's bbox from exactly this: measured across the
   * retail corpus, a stored box is the tight world AABB of the visual placed by
   * the VOB's transform. Null rather than a zero box, because a zero box would
   * refit a real bbox down to a point.
   */
  boundsOf(vob: number): readonly number[] | null {
    for (const mesh of this.instancedMeshes) {
      const vobIds = this.instanceVobIds.get(mesh);
      if (!vobIds || vobIds.indexOf(vob) === -1) continue;
      return this.meshBounds.get(mesh) ?? null;
    }
    return null;
  }

  /** A VOB's 3x3 as drawn, row-major — what a turn composes onto. */
  rotationOf(vob: number): number[] | null {
    const matrix = new THREE.Matrix4();

    for (const mesh of this.instancedMeshes) {
      const vobIds = this.instanceVobIds.get(mesh);
      const at = vobIds ? vobIds.indexOf(vob) : -1;
      if (at === -1) continue;

      mesh.getMatrixAt(at, matrix);
      const out: number[] = [];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) out.push(matrix.elements[col * 4 + row]);
      }
      return out;
    }

    return null;
  }

  /**
   * Where a VOB is drawn, in ZenGin space — or null if it is not drawn at all.
   *
   * The viewport is handed payloads, never the world, so the scene is what it
   * asks where the selected VOB is when it puts a gizmo on it.
   */
  positionOf(vob: number): [number, number, number] | null {
    const matrix = new THREE.Matrix4();

    for (const mesh of this.instancedMeshes) {
      const vobIds = this.instanceVobIds.get(mesh);
      const at = vobIds ? vobIds.indexOf(vob) : -1;
      if (at === -1) continue;

      mesh.getMatrixAt(at, matrix);
      return [matrix.elements[12], matrix.elements[13], matrix.elements[14]];
    }

    return null;
  }

  /**
   * Where to put one gizmo for a whole selection: the position of the **last**
   * VOB in it that is actually drawn, or null if none of them is.
   *
   * The last is the one just clicked, which is the one the user expects the
   * handles to appear on. It is the last *drawn* one because a selection may
   * hold VOBs with no instance — a decal, a sound VOB — and anchoring on one of
   * those would take the gizmo away from a selection full of drawable VOBs.
   */
  anchorOf(vobs: readonly number[]): [number, number, number] | null {
    for (let at = vobs.length - 1; at >= 0; at--) {
      const position = this.positionOf(vobs[at]);
      if (position !== null) return position;
    }
    return null;
  }

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
    // The one conversion the root node cannot carry: Three.js cancels the
    // mirror's effect on the front/back test, so the winding is reversed here
    // instead — in `coords`, with the rest of the ZenGin -> Three.js boundary.
    geometry.setIndex(new THREE.BufferAttribute(threeIndexOrder(new Uint32Array(group.indices)), 1));
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
