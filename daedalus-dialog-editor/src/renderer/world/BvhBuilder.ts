import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Main-thread half of the off-thread BVH build (see bvh.worker.ts).
//
// Only what is pickable gets a tree, and after the measurement that means only
// the world mesh: its BVH answers a ray in 0.2 ms p50, while the instanced VOBs
// are GPU ID-picked because a CPU raycast across them costs 14.2 ms whether or
// not they have trees. The spike's first run built 936 of them and spent 545 ms
// doing it; half of that was pure load-time cost for meshes nothing raycasts.

interface Pending {
  geometry: THREE.BufferGeometry;
  resolve: () => void;
}

export class BvhBuilder {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker = new Worker(new URL('./bvh.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<{ id: number; serialized: never }>) => {
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);

      // setIndex: true — construction reorders the triangles, and a geometry
      // still holding the original order would raycast against a tree that
      // describes different triangles.
      entry.geometry.boundsTree = MeshBVH.deserialize(event.data.serialized, entry.geometry, {
        setIndex: true,
      });
      entry.resolve();
    };
  }

  /** Build a tree for `geometry` off-thread. The geometry stays fully usable
   *  while it runs — the worker gets copies, not the live buffers. */
  build(geometry: THREE.BufferGeometry): Promise<void> {
    const id = this.nextId++;
    const position = (geometry.getAttribute('position').array as Float32Array).slice();
    const index = (geometry.getIndex()!.array as Uint32Array).slice();

    return new Promise<void>((resolve) => {
      this.pending.set(id, { geometry, resolve });
      this.worker.postMessage({ id, position: position.buffer, index: index.buffer },
        [position.buffer, index.buffer]);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
