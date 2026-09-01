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

  it('discards a cut-out prop where its texture is see-through, so the click carries on', () => {
    // The Phase 1a limit: the pick pass drew a foliage quad whole, so clicking
    // the empty corner of a bush selected the bush — and clicking *through* the
    // gap between two branches selected them rather than the wall behind. Same
    // fix as the world occluder: sample the drawn texture at the drawn
    // threshold. A discarded fragment writes no depth either, so whatever is
    // behind the hole wins the pixel as it does on screen.
    const picker = new VobPicker();
    const foliage = new THREE.MeshBasicMaterial();
    foliage.alphaTest = 0.5;
    foliage.map = new THREE.Texture();
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), foliage, 1);

    picker.setInstancedMeshes([mesh], () => 4, new THREE.Matrix4());

    const material = picker.pickProxies[0].material as THREE.ShaderMaterial;
    expect(material.fragmentShader).toContain('discard');
    // Still the id pass: what survives the discard is the VOB's colour.
    expect(material.fragmentShader).toContain('vPickColor');
    expect(material.vertexShader).toMatch(/instanceHidden > 0\.5/);
    expect(material.uniforms.map.value).toBe(foliage.map);
    expect(material.uniforms.alphaThreshold.value).toBe(0.5);
  });

  it('picks up a prop texture decoded after the pick scene was built', async () => {
    const { renderer, pending } = fakeRenderer();
    const picker = new VobPicker();
    const foliage = new THREE.MeshBasicMaterial();
    foliage.alphaTest = 0.5;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), foliage, 1);

    picker.setInstancedMeshes([mesh], () => 4, new THREE.Matrix4());
    const material = picker.pickProxies[0].material as THREE.ShaderMaterial;
    expect(material.uniforms.map.value).not.toBeNull();

    const decoded = new THREE.Texture();
    foliage.map = decoded;
    const answer = picker.pickAsync(renderer, new THREE.PerspectiveCamera(), 1, 1, 8, 6);
    pending[0].resolve([0, 0, 0, 255]);
    await answer;

    expect(material.uniforms.map.value).toBe(decoded);
  });

  it('shares the hidden flag with the drawn mesh, so a hidden VOB is not pickable', () => {
    // Per-class visibility (§16.16) hides an instance by dropping it in the
    // vertex shader. The pick pass is a *second* draw of the same instances
    // with its own material, so a flag it did not read would leave a hidden
    // prop clickable — and clicking something invisible selects it in the tree.
    // The attribute is shared rather than copied: `geometry.clone()` copies it,
    // and a copy stops tracking the next toggle.
    const picker = new VobPicker();
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
    const hidden = new THREE.InstancedBufferAttribute(new Float32Array([0, 1]), 1);
    mesh.geometry.setAttribute('instanceHidden', hidden);

    picker.setInstancedMeshes([mesh], (_mesh, instance) => instance, new THREE.Matrix4());

    const proxy = picker.pickProxies[0];
    expect(proxy.geometry.getAttribute('instanceHidden')).toBe(hidden);
    const material = proxy.material as THREE.ShaderMaterial;
    expect(material.vertexShader).toContain('attribute float instanceHidden;');
    expect(material.vertexShader).toMatch(/instanceHidden > 0\.5/);
  });
});

describe('the world mesh as a pick occluder (level-editor.md §16.24 3)', () => {
  // The pick scene held the VOB proxies and *nothing else*, so no world
  // geometry ever wrote depth into the 1x1 target and a VOB behind a wall won
  // the pixel — reported on a Khorinis tower. The fix is one more draw into a
  // one-pixel view offset: the world mesh, depth only.
  const worldMesh = (material: THREE.Material) =>
    new THREE.Mesh(new THREE.BufferGeometry(), material);

  it('draws the world mesh into the pick scene, depth only and at the root', () => {
    const picker = new VobPicker();
    const root = new THREE.Matrix4().makeScale(0.01, 0.01, 0.01);
    const mesh = worldMesh(new THREE.MeshBasicMaterial());

    picker.setWorldMeshes([mesh], root);

    expect(picker.pickOccluders).toHaveLength(1);
    const occluder = picker.pickOccluders[0];
    // The geometry is *shared*, not cloned: the occluder needs no attribute of
    // its own, and a clone would be a second copy of the 476k-triangle world.
    expect(occluder.geometry).toBe(mesh.geometry);
    // Nothing is written to colour, so the cleared black — which the readback
    // already reads as "nothing was hit" — survives wherever the world wins the
    // depth test, and the click falls through to the BVH raycast as before.
    expect((occluder.material as THREE.Material).colorWrite).toBe(false);
    expect((occluder.material as THREE.Material).depthWrite).toBe(true);
    // The proxies carry the mirrored root themselves rather than hanging under
    // the viewport's node, and an occluder that did not would be somewhere else
    // entirely — which is worse than not occluding at all.
    expect(occluder.matrix.equals(root)).toBe(true);
    expect(occluder.matrixAutoUpdate).toBe(false);
  });

  it('leaves a blended world surface out, so you can click through glass and water', () => {
    // An alpha-blended surface does not write depth in the visible pass either:
    // what is behind it is on screen, so a click must reach it.
    const picker = new VobPicker();
    const blended = new THREE.MeshBasicMaterial();
    blended.transparent = true;

    picker.setWorldMeshes([worldMesh(blended)], new THREE.Matrix4());

    expect(picker.pickOccluders).toHaveLength(0);
  });

  it('draws an alpha-tested world surface, discarding where its texture is see-through', () => {
    // Skipping these was the whole of the leak: ZenGin's *default* alpha
    // function is NONE — "alpha on or off" — which `WorldScene` turns into an
    // `alphaTest`, and in retail NewWorld it is what **every** opaque surface
    // carries: 463,530 of the world mesh's 476,445 triangles, walls and floors
    // included, against 12,915 blended ones and not a single alphaFunc 0. So an
    // occluder pass that skipped alpha-tested meshes occluded nothing at all,
    // and every VOB stayed clickable through the floor it sits under.
    //
    // The hole in a fence still has to stay clickable, so the occluder samples
    // the same texture at the same alpha threshold as the drawn mesh does.
    const picker = new VobPicker();
    const cutout = new THREE.MeshBasicMaterial();
    cutout.alphaTest = 0.5;
    cutout.map = new THREE.Texture();

    picker.setWorldMeshes([worldMesh(cutout)], new THREE.Matrix4());

    expect(picker.pickOccluders).toHaveLength(1);
    const material = picker.pickOccluders[0].material as THREE.ShaderMaterial;
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.fragmentShader).toContain('discard');
    expect(material.uniforms.map.value).toBe(cutout.map);
    expect(material.uniforms.alphaThreshold.value).toBe(0.5);
  });

  it('picks up a texture decoded after the pick scene was built', async () => {
    // Textures are decoded on demand, so an occluder built before its pixels
    // arrived holds none — and one that never looked again would keep sampling
    // the stand-in for the world's life. The stand-in is opaque, which is what
    // the drawn mesh looks like until its texture lands.
    const { renderer, pending } = fakeRenderer();
    const picker = new VobPicker();
    const cutout = new THREE.MeshBasicMaterial();
    cutout.alphaTest = 0.5;

    picker.setWorldMeshes([worldMesh(cutout)], new THREE.Matrix4());
    const material = picker.pickOccluders[0].material as THREE.ShaderMaterial;
    expect(material.uniforms.map.value).not.toBeNull();

    const decoded = new THREE.Texture();
    cutout.map = decoded;
    const answer = picker.pickAsync(renderer, new THREE.PerspectiveCamera(), 1, 1, 8, 6);
    pending[0].resolve([0, 0, 0, 255]);
    await answer;

    expect(material.uniforms.map.value).toBe(decoded);
  });

  it('replaces the occluders on a rebuild without disposing the world geometry', () => {
    // A structural op rebuilds the scene, and the geometry here belongs to the
    // `WorldScene` that made it — disposing it would release buffers the very
    // next frame draws with.
    const picker = new VobPicker();
    const mesh = worldMesh(new THREE.MeshBasicMaterial());
    const disposed = jest.fn();
    mesh.geometry.addEventListener('dispose', disposed);

    picker.setWorldMeshes([mesh], new THREE.Matrix4());
    picker.setWorldMeshes([mesh], new THREE.Matrix4());

    expect(picker.pickOccluders).toHaveLength(1);
    expect(disposed).not.toHaveBeenCalled();

    picker.dispose();
    expect(picker.pickOccluders).toHaveLength(0);
    expect(disposed).not.toHaveBeenCalled();
  });

  it('keeps the occluders when the VOB proxies are rebuilt', () => {
    // The two are set from the same effect but are not the same call, and
    // `setInstancedMeshes` clears what it owns. Clearing the occluders there
    // would silently take the fix back out.
    const picker = new VobPicker();
    picker.setWorldMeshes([worldMesh(new THREE.MeshBasicMaterial())], new THREE.Matrix4());

    const vobs = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    picker.setInstancedMeshes([vobs], () => 3, new THREE.Matrix4());

    expect(picker.pickOccluders).toHaveLength(1);
    expect(picker.pickProxies).toHaveLength(1);
  });
});
