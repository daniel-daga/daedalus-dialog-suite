/**
 * Disposing the BVH builder settles the promises its builds handed out
 * (world-editor-review-2026-08-29, renderer 4).
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';

const worker = {
  onmessage: null as ((event: MessageEvent) => void) | null,
  terminate: jest.fn(),
  postMessage: jest.fn(),
};

jest.mock('../src/renderer/world/bvhWorker', () => ({
  createBvhWorker: () => worker,
}));

import { BvhBuilder } from '../src/renderer/world/BvhBuilder';

const geometry = (): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  return g;
};

describe('BvhBuilder.dispose', () => {
  it('settles the builds it will never finish, so an awaiting caller does not hang', async () => {
    const builder = new BvhBuilder();
    const pending = builder.build(geometry());

    builder.dispose();

    // The scene effect's cleanup disposes on every rebuild, and `renderFrom`
    // and `benchmark` sit inside `await Promise.all([bvhReady, texturesReady])`
    // when it happens: a promise that never settles hangs them, so the `finally`
    // that restores the controls and the draw loop never runs.
    const outcome = await Promise.race([
      pending.then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 50)),
    ]);
    expect(outcome).toBe('settled');
    expect(worker.terminate).toHaveBeenCalled();
  });
});
