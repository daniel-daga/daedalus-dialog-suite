import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Bounds trees, off the main thread (level-editor.md §3, result 3). Building
// 352 of them eagerly costs ~484 ms of the spike's cold open, all of it on the
// thread that also has to draw — and none of it is invalidated by an edit, so
// it belongs to the cold open rather than to the reload path.
//
// three-mesh-bvh ships `GenerateMeshBVHWorker`, which is deliberately not used
// here: it *transfers* the live geometry's position and index buffers into the
// worker, leaving the geometry unusable until the build finishes. The viewport
// is already drawing by then. So this worker takes copies instead and returns a
// serialized tree the main thread deserializes onto the real geometry — the
// index it returns is the reordered one BVH construction produces, which the
// geometry must adopt or its triangles no longer match the tree.

export interface BvhRequest {
  id: number;
  position: ArrayBuffer;
  index: ArrayBuffer;
}

self.onmessage = (event: MessageEvent<BvhRequest>) => {
  const { id, position, index } = event.data;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));

  const serialized = MeshBVH.serialize(new MeshBVH(geometry));
  const transfer: ArrayBuffer[] = [
    ...(serialized.roots as ArrayBuffer[]),
    (serialized.index as Uint32Array).buffer as ArrayBuffer,
  ];

  (self as unknown as Worker).postMessage({ id, serialized }, transfer);
};
