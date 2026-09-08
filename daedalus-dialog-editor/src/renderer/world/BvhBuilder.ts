import * as THREE from 'three';
import { MeshBVH, type SerializedBVH } from 'three-mesh-bvh';
import { createBvhWorker } from './bvhWorker';

// Main-thread half of the off-thread BVH build (see bvh.worker.ts).
//
// Only what is pickable gets a tree, and after the measurement that means only
// the world mesh: its BVH answers a ray in 0.2 ms p50, while the instanced VOBs
// are GPU ID-picked because a CPU raycast across them costs 14.2 ms whether or
// not they have trees. The spike's first run built 936 of them and spent 545 ms
// doing it; half of that was pure load-time cost for meshes nothing raycasts.
//
// **One build per mesh payload, not per edit** (review §3.3, #220). Every
// structural op rebuilds `WorldScene`, so the geometry is new every time — but
// the world *mesh* is untouched by moving, adding or deleting a VOB, and
// rebuilding its tree cost the 145–590 ms of the cold open again, during which
// `acceleratedRaycast` falls back to a linear sweep of 476k triangles for every
// pivot press, terrain click and `raycastDown`. So the builder keeps the
// serialized trees against the payload they came from and deserializes them
// into the fresh geometry instead. The roots buffers are *shared* by
// `MeshBVH.deserialize`, not copied, which the library documents and which is
// safe here because nothing ever refits a tree.
//
// The builder therefore outlives the scene effect that used to own it: a
// rebuild `settle()`s the builds it abandoned, and only the viewport going away
// `dispose()`s the worker.

interface Pending {
  geometry: THREE.BufferGeometry;
  resolve: (serialized: SerializedBVH | null) => void;
}

/** No payload seen yet — distinct from any key a caller could pass, `null`
 *  and `undefined` included. */
const NOTHING_BUILT = Symbol('nothing built');

export class BvhBuilder {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  /** The payload the stored trees were built from, by identity. */
  private key: unknown = NOTHING_BUILT;
  private trees: SerializedBVH[] | null = null;

  constructor() {
    this.worker = createBvhWorker();
    this.worker.onmessage = (event: MessageEvent<{ id: number; serialized: SerializedBVH }>) => {
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);

      applyTree(entry.geometry, event.data.serialized);
      entry.resolve(event.data.serialized);
    };
  }

  /**
   * Give every geometry a tree: built off-thread the first time `key` is seen,
   * deserialized from the stored trees every time after.
   *
   * `key` is the mesh payload, compared by identity — a new payload is a new
   * world mesh, and nothing else produces one.
   */
  async buildAll(geometries: readonly THREE.BufferGeometry[], key: unknown): Promise<void> {
    // The count is part of the match: the trees are paired with geometries by
    // position, so a mismatch has to rebuild rather than hand one to the wrong
    // mesh. Nothing should produce it — a payload decides its meshes.
    const stored = this.key === key && this.trees?.length === geometries.length
      ? this.trees : null;
    if (stored !== null) {
      geometries.forEach((geometry, index) => applyTree(geometry, stored[index]));
      return;
    }

    this.key = NOTHING_BUILT;
    this.trees = null;
    const built = await Promise.all(geometries.map((geometry) => this.build(geometry)));
    // A build the scene abandoned resolves with nothing (see `settle`), and
    // half a payload's trees are not that payload's trees.
    if (built.some((tree) => tree === null)) return;

    this.key = key;
    this.trees = built as SerializedBVH[];
  }

  /** Build a tree for `geometry` off-thread. The geometry stays fully usable
   *  while it runs — the worker gets copies, not the live buffers. */
  private build(geometry: THREE.BufferGeometry): Promise<SerializedBVH | null> {
    const id = this.nextId++;
    const position = (geometry.getAttribute('position').array as Float32Array).slice();
    const index = (geometry.getIndex()!.array as Uint32Array).slice();

    return new Promise<SerializedBVH | null>((resolve) => {
      this.pending.set(id, { geometry, resolve });
      this.worker.postMessage({ id, position: position.buffer, index: index.buffer },
        [position.buffer, index.buffer]);
    });
  }

  /**
   * Settle what the scene being torn down will never wait for.
   *
   * The scene effect abandons its builds on every rebuild, and `renderFrom` /
   * `benchmark` are inside `await Promise.all([bvhReady, texturesReady])` while
   * it happens: a promise left pending hangs them instead of letting them find
   * a geometry with no tree. Resolved with `null`, not rejected — the caller's
   * scene is being torn down, which is not an error it can act on, and `null`
   * is what stops a half-finished payload being cached.
   */
  settle(): void {
    for (const entry of this.pending.values()) entry.resolve(null);
    this.pending.clear();
  }

  dispose(): void {
    this.worker.terminate();
    this.settle();
    this.key = NOTHING_BUILT;
    this.trees = null;
  }
}

/** setIndex: true — construction reorders the triangles, and a geometry still
 *  holding the original order would raycast against a tree that describes
 *  different triangles. */
function applyTree(geometry: THREE.BufferGeometry, serialized: SerializedBVH): void {
  geometry.boundsTree = MeshBVH.deserialize(serialized, geometry, { setIndex: true });
}
