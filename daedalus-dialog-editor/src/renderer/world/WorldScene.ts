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

/**
 * A VOB is hard to tell from the world mesh (2026-08-27), and the answer asked
 * for is a faint outline on VOB visuals.
 *
 * It is drawn *inside* the VOB's own shader rather than as an outline pass,
 * because the alternative is a second `InstancedMesh` per visual — 724 more
 * draw calls every frame, in the viewport that exists to keep per-frame work
 * off the CPU (render-performance.md). This costs no draw call, no geometry, no
 * uniform to update and no CPU work at all: it is a handful of ALU per VOB
 * fragment, and only VOB materials compile it.
 *
 * What it does is darken the surface as it turns away from the eye, so the
 * silhouette of every VOB reads as a soft dark contour against whatever it
 * stands in front of. `MeshBasicMaterial` and baked vertex colours are no
 * obstacle: this multiplies the outgoing light after the texture and the baked
 * colour, and adds no light source.
 *
 * Deliberately faint and never a selection state — selection is the gizmo, and
 * a legibility aid that competed with it would make the selected VOB harder to
 * find, not easier.
 */
const OUTLINE_DARKEN = 0.7;

/** Keeps the darkening near the silhouette: at 4, a surface has to be within
 *  ~25° of edge-on before it loses a quarter of the effect's strength. */
const OUTLINE_POWER = 4.0;

/**
 * The `onBeforeCompile` every VOB material shares.
 *
 * One module-level function on purpose: `customProgramCacheKey` defaults to
 * `onBeforeCompile.toString()`, so all VOB materials land on one program and
 * the untouched world-mesh materials — which keep `Material`'s no-op hook —
 * land on another. A hook created per material would compare the same way, but
 * this makes the sharing the reason rather than the coincidence.
 */
function outlineVobs(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = `varying vec3 vVobNormal;\nvarying vec3 vVobView;\n${
    shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
  // After project_vertex, so mvPosition already carries the instance.
  vec3 vobNormal = normal;
  #ifdef USE_INSTANCING
    vobNormal = mat3( instanceMatrix ) * vobNormal;
  #endif
  vVobNormal = normalMatrix * vobNormal;
  vVobView = -mvPosition.xyz;`,
    )
  }`;

  shader.fragmentShader = `varying vec3 vVobNormal;\nvarying vec3 vVobView;\n${
    shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      // abs(), because the mirrored root flips the sign of the normal and a
      // signed facing term would outline the front faces instead of the edges.
      `float vobFacing = abs( dot( normalize( vVobNormal ), normalize( vVobView ) ) );
  outgoingLight *= mix( 1.0, ${OUTLINE_DARKEN.toFixed(2)}, pow( 1.0 - vobFacing, ${OUTLINE_POWER.toFixed(1)} ) );
  #include <opaque_fragment>`,
    )
  }`;
}

interface TextureSlot {
  texture: THREE.Texture | null;
  materials: THREE.MeshBasicMaterial[];
}

/**
 * Decoded textures that outlive the scene holding them, for one world.
 *
 * A structural op rebuilds the scene — an instance cannot be appended to an
 * allocated `InstancedMesh` (level-editor.md §7) — and a fresh `WorldScene`
 * starts with an empty texture map, so without this every placement re-decodes
 * all 490 of NewWorld's: the 549 ms that was deliberately moved off the cold
 * open, paid again on an edit, for pixels that did not change.
 *
 * **A cached scene does not own its textures; this does.** A `THREE.Texture`
 * holds GPU memory, and a rebuild that disposed one would hand the next scene a
 * released texture. `WorldScene.dispose` therefore leaves them alone whenever a
 * cache was handed in, and the cache is disposed by whoever holds it — the
 * viewport, when the world is closed or replaced.
 */
export class TextureCache {
  private textures = new Map<string, THREE.Texture>();

  /** The world these pixels belong to. `textureCacheFor` is what compares it. */
  constructor(readonly key: string) {}

  get(name: string): THREE.Texture | undefined {
    return this.textures.get(name);
  }

  set(name: string, texture: THREE.Texture): void {
    this.textures.set(name, texture);
  }

  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }
}

/**
 * The cache to use for `key`: `current` when it is the same world, otherwise a
 * fresh one — and the old one is released, since nothing else holds it.
 *
 * Scoped exactly like the camera pose the viewport restores beside it, and for
 * the same reason: what survives a rebuild must not survive an *open*, or a
 * different world is drawn with another world's pixels under the same names.
 */
export function textureCacheFor(current: TextureCache | null, key: string): TextureCache {
  if (current !== null && current.key === key) return current;
  current?.dispose();
  return new TextureCache(key);
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

  /** @param textureCache decoded pixels kept across the rebuild a structural op
   *   forces, and the owner of their disposal. Null decodes from scratch and
   *   disposes what it decoded. */
  constructor(private textureCache: TextureCache | null = null) {
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
          this.geometry(group), this.material(group, true), visual.count,
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

  /**
   * Decode every texture the scene still needs, one at a time — a world with
   * 490 of them must not open 490 concurrent IPC calls — and apply each to
   * every material that named it.
   *
   * `cancelled` is checked on both sides of the await: the world can be closed
   * while this is in flight, and pixels applied to a torn-down scene are a
   * texture nothing will ever dispose.
   */
  async loadPendingTextures(
    load: (name: string) => Promise<DecodedTexture | null>,
    cancelled: () => boolean,
  ): Promise<void> {
    for (const name of this.pendingTextureNames()) {
      if (cancelled()) return;
      const decoded = await load(name);
      if (cancelled()) return;
      if (decoded) this.applyTexture(decoded);
    }
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
    const name = decoded.name.toUpperCase();
    const slot = this.textures.get(name);
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
    this.textureCache?.set(name, texture);
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
    // Only what this scene owns. With a cache the textures outlive it by
    // design, and disposing them here would release GPU memory the very next
    // scene is about to draw with — see `TextureCache`.
    if (this.textureCache === null) {
      for (const slot of this.textures.values()) slot.texture?.dispose();
    }

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

  /** @param vob whether this draws a VOB rather than the world mesh — the one
   *   difference is the silhouette outline, see `outlineVobs`. */
  private material(group: DrawGroup, vob = false): THREE.MeshBasicMaterial {
    // MeshBasicMaterial, not a lit one: ZenGin's lighting is baked into the
    // vertex colours and there is nothing dynamic in an editor viewport to
    // relight it with.
    const material = new THREE.MeshBasicMaterial({
      vertexColors: group.lights !== null,
      side: THREE.FrontSide,
    });
    if (vob) material.onBeforeCompile = outlineVobs;

    if (group.texture === '') {
      material.color.setRGB(
        SRGB_TO_LINEAR[group.color[0]], SRGB_TO_LINEAR[group.color[1]], SRGB_TO_LINEAR[group.color[2]],
      );
    } else {
      const name = group.texture.toUpperCase();
      let slot = this.textures.get(name);
      if (slot === undefined) {
        // Already decoded for this world, if a previous scene decoded it: the
        // slot starts filled, `pendingTextureNames` never names it, and the
        // material below is textured before the first frame is drawn.
        slot = { texture: this.textureCache?.get(name) ?? null, materials: [] };
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
