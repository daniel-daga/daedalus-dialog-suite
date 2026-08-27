/**
 * The prop pick, without a GPU (level-editor.md §3, the app's own viewport).
 *
 * `VobPicker` draws the instanced VOBs into a 1x1 buffer and reads the pixel
 * back. Measured in the app's own viewport, that readback is the whole cost:
 * 2.1 ms on an idle GPU and **7.2 ms when the GPU is shared**, where it loses
 * to the 3.8 ms CPU raycast it was chosen over — because
 * `readRenderTargetPixels` is *synchronous* and stalls the pipeline until the
 * GPU has caught up. So the readback is asynchronous, and what that changes is
 * assertable here rather than only on a machine with a GPU:
 *
 *   - the synchronous readback is not called at all, by anything
 *   - the render target and the camera's view offset are restored *before* the
 *     readback completes — the draw loop keeps rendering during it, and a
 *     viewport left pointed at a 1x1 target would draw the world into one pixel
 *   - two picks can be in flight at once, so neither may read the other's bytes
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { NO_PICK, encodePickId } from '../src/renderer/world/pickIds';
import { VobPicker } from '../src/renderer/world/VobPicker';

interface Deferred {
  buffer: Uint8Array;
  resolve: (pixel: readonly number[]) => void;
}

/** The four renderer calls `VobPicker` makes, and nothing else. A real
 *  `WebGLRenderer` needs a GL context; the picker needs none of it. */
function fakeRenderer() {
  const pending: Deferred[] = [];
  const calls = { renders: 0, clears: 0, synchronousReads: 0 };
  let target: THREE.WebGLRenderTarget | null = null;

  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next; },
    setClearColor: () => {},
    clear: () => { calls.clears += 1; },
    render: () => { calls.renders += 1; },
    // The one this change exists to remove. Present so that using it is a
    // failure rather than a TypeError somewhere less obvious.
    readRenderTargetPixels: () => { calls.synchronousReads += 1; },
    readRenderTargetPixelsAsync: (
      _target: THREE.WebGLRenderTarget,
      _x: number, _y: number, _width: number, _height: number,
      buffer: Uint8Array,
    ) => new Promise<Uint8Array>((resolve) => {
      // Faithful to three's own implementation: the bytes land in the caller's
      // buffer at the *end*, immediately before the promise settles.
      pending.push({
        buffer,
        resolve: (pixel) => { buffer.set(pixel); resolve(buffer); },
      });
    }),
  };

  return {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    calls,
    pending,
    currentTarget: () => target,
  };
}

function pickerWithOneVob(vobId: number) {
  const picker = new VobPicker();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
  picker.setInstancedMeshes([mesh], () => vobId, new THREE.Matrix4());
  return { picker, mesh };
}

const idPixel = (id: number): number[] =>
  [...encodePickId(id).map((channel) => Math.round(channel * 255)), 255];

describe('the prop pick', () => {
  it('reads the pixel back asynchronously — never through the stalling call', async () => {
    const { renderer, calls, pending } = fakeRenderer();
    const { picker } = pickerWithOneVob(42);
    const camera = new THREE.PerspectiveCamera();

    const answer = picker.pickAsync(renderer, camera, 100, 50, 800, 600);
    expect(pending).toHaveLength(1);
    pending[0].resolve(idPixel(42));

    expect(await answer).toBe(42);
    // 2.1 ms idle / 7.2 ms contended was this call, and it is the reason the
    // GPU pick lost to the CPU raycast on a busy GPU.
    expect(calls.synchronousReads).toBe(0);
    expect(calls.renders).toBe(1);
    expect(calls.clears).toBe(1);
  });

  it('restores the render target and the view offset before the readback finishes', async () => {
    // The draw loop renders the world every frame *during* the readback now.
    // If the 1x1 pick target is still bound, or the camera is still reframed
    // onto one pixel, the viewport draws the world into that pixel until the
    // pick returns.
    const { renderer, currentTarget, pending } = fakeRenderer();
    const { picker } = pickerWithOneVob(7);
    const camera = new THREE.PerspectiveCamera();
    const previous = new THREE.WebGLRenderTarget(4, 4);
    renderer.setRenderTarget(previous);

    const answer = picker.pickAsync(renderer, camera, 10, 10, 800, 600);

    expect(currentTarget()).toBe(previous);
    expect(camera.view?.enabled).toBe(false);

    pending[0].resolve(idPixel(7));
    expect(await answer).toBe(7);
    expect(currentTarget()).toBe(previous);
  });

  it('gives each in-flight pick its own buffer', async () => {
    // Two clicks inside one readback is an ordinary double-click. A buffer
    // shared between them makes each answer depend on the order the fences
    // happen to settle in.
    const { renderer, pending } = fakeRenderer();
    const { picker } = pickerWithOneVob(1);
    const camera = new THREE.PerspectiveCamera();

    const first = picker.pickAsync(renderer, camera, 10, 10, 800, 600);
    const second = picker.pickAsync(renderer, camera, 20, 20, 800, 600);

    expect(pending).toHaveLength(2);
    expect(pending[0].buffer).not.toBe(pending[1].buffer);

    // Settled out of order, as two fences on a busy GPU may.
    pending[1].resolve(idPixel(5));
    pending[0].resolve(idPixel(9));
    expect(await first).toBe(9);
    expect(await second).toBe(5);
  });

  it('reads a cleared buffer as nothing, not as VOB 0', async () => {
    const { renderer, pending } = fakeRenderer();
    const { picker } = pickerWithOneVob(0);
    const camera = new THREE.PerspectiveCamera();

    const answer = picker.pickAsync(renderer, camera, 10, 10, 800, 600);
    pending[0].resolve([0, 0, 0, 255]);

    expect(await answer).toBe(NO_PICK);
  });

  it('warms the pick pass with a draw and no readback', async () => {
    // The first GPU pick of a session costs 53 ms — once, 276 ms — compiling
    // the pick shader. It is a first-use cost like texture upload, and a world
    // that has just opened is where it belongs, not the first click.
    const { renderer, calls, pending, currentTarget } = fakeRenderer();
    const { picker } = pickerWithOneVob(3);
    const camera = new THREE.PerspectiveCamera();

    picker.warm(renderer, camera);

    expect(calls.renders).toBe(1);
    expect(pending).toHaveLength(0);
    expect(calls.synchronousReads).toBe(0);
    expect(currentTarget()).toBeNull();
    expect(camera.view?.enabled).toBe(false);
  });
});
