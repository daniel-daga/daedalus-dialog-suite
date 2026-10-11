/**
 * The world-mesh BVH is built once per mesh payload, not once per edit
 * (level-editor-review-2026-09-04 §3.3, #220).
 *
 * The scene effect rebuilds `WorldScene` on every structural op — a VOB moved,
 * added, deleted — and rebuilt the trees with it, though the world *mesh* is
 * untouched by all of them. Each rebuild copies position and index and spends
 * the 145–590 ms the plan books against the cold open, and until the trees land
 * `acceleratedRaycast` falls back to a linear sweep of 476k triangles for every
 * pivot press, terrain click and `raycastDown`.
 *
 * So the builder remembers the serialized trees against the payload they came
 * from and deserializes them into the fresh geometry instead. What that has to
 * be right about is here: the worker is asked once, the second scene still ends
 * up with trees, and a genuinely new payload is built again.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { describe, it, expect, beforeEach } from '@jest/globals';

const worker = {
  onmessage: null as ((event: MessageEvent) => void) | null,
  terminate: jest.fn(),
  postMessage: jest.fn(),
};

jest.mock('../src/renderer/world/bvhWorker', () => ({
  createBvhWorker: () => worker,
}));

import { BvhBuilder } from '../src/renderer/world/BvhBuilder';

/** One triangle, with the position and index a build reads. */
const geometry = (): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  return g;
};

/** Answer every posted build with a tree the worker really could have made:
 *  built here on the main thread from the same geometry, then serialized. */
function answerBuilds(): void {
  const posted = worker.postMessage.mock.calls.map((call) => call[0] as { id: number });
  worker.postMessage.mockClear();
  for (const { id } of posted) {
    const source = geometry();
    const { MeshBVH } = jest.requireActual('three-mesh-bvh') as typeof import('three-mesh-bvh');
    const serialized = MeshBVH.serialize(new MeshBVH(source));
    worker.onmessage?.({ data: { id, serialized } } as MessageEvent);
  }
}

describe('BvhBuilder — one build per mesh payload', () => {
  beforeEach(() => {
    worker.postMessage.mockClear();
    worker.terminate.mockClear();
  });

  it('builds for a payload it has not seen, and gives the geometry its tree', async () => {
    const builder = new BvhBuilder();
    const payload = { theMesh: true };
    const first = geometry();

    const ready = builder.buildAll([first], payload);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    answerBuilds();
    await ready;

    expect(first.boundsTree).toBeDefined();
    builder.dispose();
  });

  it('asks the worker nothing the second time the same payload is rebuilt', async () => {
    // The case this exists for: a VOB op rebuilds the scene, so the geometry is
    // new, but the payload it was built from is the very same object.
    const builder = new BvhBuilder();
    const payload = { theMesh: true };

    const first = geometry();
    const ready = builder.buildAll([first], payload);
    answerBuilds();
    await ready;

    const second = geometry();
    await builder.buildAll([second], payload);

    expect(worker.postMessage).not.toHaveBeenCalled();
    // Still a tree — deserialized from what the first build produced, not
    // skipped. A geometry without one raycasts linearly and silently.
    expect(second.boundsTree).toBeDefined();
    builder.dispose();
  });

  it('builds again when a different payload arrives', async () => {
    const builder = new BvhBuilder();

    const first = geometry();
    const firstReady = builder.buildAll([first], { theMesh: 1 });
    answerBuilds();
    await firstReady;

    const second = geometry();
    const secondReady = builder.buildAll([second], { theMesh: 2 });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    answerBuilds();
    await secondReady;

    expect(second.boundsTree).toBeDefined();
    builder.dispose();
  });

  it('builds again when the payload matches but the mesh count does not', async () => {
    // Nothing should produce this — a payload decides its meshes — but the
    // stored trees are matched to geometries by position, so a mismatch has to
    // rebuild rather than hand a tree to the wrong mesh.
    const builder = new BvhBuilder();
    const payload = { theMesh: true };

    const ready = builder.buildAll([geometry()], payload);
    answerBuilds();
    await ready;

    const two = [geometry(), geometry()];
    const again = builder.buildAll(two, payload);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    answerBuilds();
    await again;

    for (const g of two) expect(g.boundsTree).toBeDefined();
    builder.dispose();
  });

  it('settles a build the scene abandoned without losing the worker', async () => {
    // A rebuild that arrives mid-build abandons it: `renderFrom` and
    // `benchmark` sit inside `await Promise.all([bvhReady, texturesReady])`,
    // so a promise left pending hangs them. The builder outlives the scene now,
    // so settling must not terminate the worker with it.
    const builder = new BvhBuilder();
    const pending = builder.buildAll([geometry()], { theMesh: true });

    builder.settle();

    const outcome = await Promise.race([
      pending.then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 50)),
    ]);
    expect(outcome).toBe('settled');
    expect(worker.terminate).not.toHaveBeenCalled();
    builder.dispose();
  });

  it('caches nothing from a build that was abandoned', async () => {
    // Half a payload's trees are not that payload's trees.
    const builder = new BvhBuilder();
    const payload = { theMesh: true };

    // Started and abandoned before the worker ever answered.
    const abandoned = builder.buildAll([geometry()], payload);
    builder.settle();
    await abandoned;
    worker.postMessage.mockClear();

    const retry = builder.buildAll([geometry()], payload);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    answerBuilds();
    await retry;
    builder.dispose();
  });
});
