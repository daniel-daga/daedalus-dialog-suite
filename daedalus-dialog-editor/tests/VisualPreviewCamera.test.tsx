/**
 * The preview camera is the user's, not the visual's (#441): swapping a head, a
 * body or an armour rebuilds the meshes and leaves the orbit where the hand put
 * it — even when the new bounds are nothing like the old ones. jsdom has no GL,
 * so the renderer is the viewport suites' stand-in and the assertions are on the
 * camera and the scene it was handed; the feel of the orbit wants a human eye.
 *
 * @jest-environment jsdom
 */

import React, { useRef } from 'react';
import * as THREE from 'three';
import { act, render, waitFor } from '@testing-library/react';
import type { DecodedTexture, DrawGroup, VisualScene } from '../src/shared/worldTypes';
import { useVisualPreviewCanvas } from '../src/renderer/components/world/hooks/useVisualPreviewCanvas';

// A `require` in the factory: `three` is imported at the top of this file, so
// the hoisted factory runs before a module-level import binding would exist.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('three', () => require('./worldViewportMocks').mockThree());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => require('./worldViewportMocks').mockOrbitControls());

function group(overrides: Partial<DrawGroup> = {}): DrawGroup {
  return {
    texture: 'NW_WOOD.TGA', color: [255, 255, 255, 255], alphaFunc: 0, texAniMapMode: 0, texAniFps: 0,
    texAniMapDir: [0, 0], envMapping: false, envMappingStrength: 0, waveMode: 0, waveSpeed: 0,
    waveMaxAmplitude: 0, waveGridSize: 0, ignoreSun: false, disableLightmap: false, materials: 1,
    vertexCount: 3, triangleCount: 1,
    positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]).buffer,
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer,
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
    indices: new Uint32Array([0, 1, 2]).buffer,
    lights: null,
    ...overrides,
  };
}

const BODY_TEXTURE = 'ARMOR_VLK_H_V1_C0.TGA';
const HEAD_TEXTURE = 'HUM_HEAD_V18_C0.TGA';

/** An armour body: a narrow box, the first thing the preview shows. */
const BODY: VisualScene = {
  name: 'Armor_Vlk_H.asc', source: 'ARMOR_VLK_H.MDM', groups: [group({ texture: BODY_TEXTURE })],
  bounds: [-30, 0, -20, 30, 180, 20], triangleCount: 1,
};
/** A head whose bounds are nothing like the body's, so a reframe would show. */
const HEAD: VisualScene = {
  name: 'Hum_Head_Fatbald.MDM', source: 'HUM_HEAD_FATBALD.MDM', groups: [group({ texture: HEAD_TEXTURE })],
  bounds: [-400, -100, -400, 400, 600, 400], triangleCount: 1,
};

const textureOf = (name: string): DecodedTexture => (
  { name, width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]).buffer }
);

type LoadTexture = (name: string, maxSize: number) => Promise<DecodedTexture | null>;

/** What the hook is for: one visual, in a canvas, outliving the visual. */
function Harness({ visual, loadTexture }: { visual: VisualScene; loadTexture: LoadTexture }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useVisualPreviewCanvas(canvasRef, visual, loadTexture, 256);
  return <canvas ref={canvasRef} />;
}

describe('useVisualPreviewCanvas', () => {
  let frames: Map<number, FrameRequestCallback>;
  let cancelled: number[];
  let drawn: Array<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera }>;

  beforeEach(() => {
    frames = new Map();
    cancelled = [];
    drawn = [];
    let handle = 0;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++handle, callback);
      return handle;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((asked) => {
      cancelled.push(asked);
      frames.delete(asked);
    });
    jest.spyOn(THREE.WebGLRenderer.prototype, 'render').mockImplementation((...args: unknown[]) => {
      drawn.push({ scene: args[0] as THREE.Scene, camera: args[1] as THREE.PerspectiveCamera });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Run the frame the loop last asked for. */
  function tick(): void {
    const pending = [...frames.entries()].pop();
    if (pending === undefined) throw new Error('The loop asked for no frame');
    frames.delete(pending[0]);
    pending[1](0);
  }

  /** Mount the harness and run its first frame, which waits on the lazily
   *  imported controls. */
  async function mount(visual: VisualScene, loadTexture: LoadTexture) {
    const view = render(<Harness visual={visual} loadTexture={loadTexture} />);
    await waitFor(() => expect(frames.size).toBeGreaterThan(0));
    tick();
    return view;
  }

  /** The maps carried by the meshes in a drawn scene. */
  function maps(scene: THREE.Scene): Array<THREE.Texture | null> {
    const found: Array<THREE.Texture | null> = [];
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) found.push((mesh.material as THREE.MeshLambertMaterial).map);
    });
    return found;
  }

  it('leaves the camera where the user put it when the visual changes', async () => {
    const loadTexture = jest.fn(async (name: string) => textureOf(name));
    const { rerender } = await mount(BODY, loadTexture);
    const camera = drawn[0].camera;

    // The hand: an orbit nothing else repeats.
    camera.position.set(3, 1.5, -2);
    camera.lookAt(0, 0.5, 0);
    const where = camera.position.clone();
    const facing = camera.quaternion.clone();

    rerender(<Harness visual={HEAD} loadTexture={loadTexture} />);
    await waitFor(() => expect(loadTexture).toHaveBeenCalledWith(HEAD_TEXTURE, 256));
    tick();
    tick();

    const last = drawn[drawn.length - 1].camera;
    expect(last).toBe(camera);
    expect(last.position.toArray()).toEqual(where.toArray());
    expect(last.quaternion.toArray()).toEqual(facing.toArray());
  });

  it('draws the new meshes at once, and once more when their map decodes', async () => {
    let release: (texture: DecodedTexture) => void = () => {};
    const loadTexture = jest.fn((name: string) => (name === HEAD_TEXTURE
      ? new Promise<DecodedTexture | null>((resolve) => { release = resolve; })
      : Promise.resolve(textureOf(name))));
    const { rerender } = await mount(BODY, loadTexture);
    await waitFor(() => expect(loadTexture).toHaveBeenCalledWith(BODY_TEXTURE, 256));
    tick();

    rerender(<Harness visual={HEAD} loadTexture={loadTexture} />);
    await waitFor(() => expect(loadTexture).toHaveBeenCalledWith(HEAD_TEXTURE, 256));
    const before = drawn.length;
    tick();
    expect(drawn.length).toBeGreaterThan(before);
    expect(maps(drawn[drawn.length - 1].scene)).toEqual([null]);

    await act(async () => { release(textureOf(HEAD_TEXTURE)); await Promise.resolve(); });
    tick();
    expect(maps(drawn[drawn.length - 1].scene)).toEqual([expect.anything()]);
  });

  it('disposes the renderer and its context when the preview goes', async () => {
    const loadTexture = jest.fn(async (name: string) => textureOf(name));
    const dispose = jest.spyOn(THREE.WebGLRenderer.prototype, 'dispose');
    const loseContext = jest.spyOn(THREE.WebGLRenderer.prototype, 'forceContextLoss');
    const { unmount } = await mount(BODY, loadTexture);

    unmount();

    expect(dispose).toHaveBeenCalled();
    expect(loseContext).toHaveBeenCalled();
    expect(cancelled).not.toHaveLength(0);
  });
});
