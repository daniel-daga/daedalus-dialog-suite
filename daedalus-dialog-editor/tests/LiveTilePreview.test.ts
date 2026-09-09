/**
 * The hovered tile's live render (level-editor.md §16.26 row 1).
 *
 * A still PNG and a live scene are indistinguishable at 96 px until one of
 * them moves, so what this suite checks is the motion and the lifetime: the
 * canvas reaches the tile under the cursor, the camera turns around the
 * framed target while it is there, the pointer takes the turn over from the
 * clock, and leaving puts everything back. jsdom has no GL, so the renderer
 * is the viewport suites' canvas-backed stand-in and the assertions are on
 * the camera it was handed — the pixels want a human eye.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import type { DecodedTexture, DrawGroup, VisualScene } from '../src/shared/worldTypes';
import { frameVisual } from '../src/renderer/world/VisualPreviewScene';
import { LiveTilePreview, SPIN_RADIANS_PER_SECOND } from '../src/renderer/world/LiveTilePreview';
import { THUMBNAIL_TEXTURE_SIZE } from '../src/renderer/world/ThumbnailRenderer';

// A `require` in the factory: `three` is imported at the top of this file, so
// the hoisted factory runs before a module-level import binding would exist.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('three', () => require('./worldViewportMocks').mockThree());

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

const VISUAL: VisualScene = {
  name: 'NW_CRATE.MRM', source: 'NW_CRATE.MRM', groups: [group()], bounds: [0, 0, 0, 200, 100, 50], triangleCount: 1,
};
const WOOD: DecodedTexture = { name: 'NW_WOOD.TGA', width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]).buffer };

/** Where `frameVisual` puts the orbit centre for VISUAL — the point every
 *  frame's camera has to stay the same distance from. */
const TARGET = frameVisual(new THREE.PerspectiveCamera(45, 1, 0.1, 100), VISUAL.bounds);

describe('LiveTilePreview', () => {
  let host: HTMLElement;
  let frames: Map<number, FrameRequestCallback>;
  let cancelled: number[];
  let positions: THREE.Vector3[];
  let render: jest.SpyInstance;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    frames = new Map();
    cancelled = [];
    positions = [];
    let handle = 0;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++handle, callback);
      return handle;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((asked) => {
      cancelled.push(asked);
      frames.delete(asked);
    });
    render = jest.spyOn(THREE.WebGLRenderer.prototype, 'render').mockImplementation((...args: unknown[]) => {
      positions.push((args[1] as THREE.PerspectiveCamera).position.clone());
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    host.remove();
  });

  /** Run the frame the loop last asked for, at `now` milliseconds. */
  function tick(now: number): void {
    const pending = [...frames.entries()].pop();
    if (pending === undefined) throw new Error('The loop asked for no frame');
    frames.delete(pending[0]);
    pending[1](now);
  }

  function preview(overrides: Partial<{
    loadVisual: (name: string) => Promise<VisualScene | null>;
    loadTexture: (name: string, maxSize: number) => Promise<DecodedTexture | null>;
  }> = {}) {
    const loadVisual = jest.fn(async (name: string) => (name === VISUAL.name ? VISUAL : null));
    const loadTexture = jest.fn(async () => WOOD);
    const deps = { loadVisual, loadTexture, ...overrides };
    return { live: new LiveTilePreview(deps), ...deps };
  }

  it('puts its canvas in the hovered tile and turns the visual around the framed target', async () => {
    const { live } = preview();

    await live.show(VISUAL.name, host, 96);

    expect(host.contains(live.canvas)).toBe(true);
    tick(0);
    tick(100);
    // A frame after a long stall is still one frame's turn: a tile does not
    // catch up on a spin nobody watched.
    tick(9100);

    expect(positions).toHaveLength(3);
    const [first, second, third] = positions;
    // A turn, not a drift: the same distance from the orbit centre throughout.
    expect(second.distanceTo(TARGET)).toBeCloseTo(first.distanceTo(TARGET), 5);
    expect(third.distanceTo(TARGET)).toBeCloseTo(first.distanceTo(TARGET), 5);
    const turned = (from: THREE.Vector3, to: THREE.Vector3) => Math.abs(
      Math.atan2(to.x - TARGET.x, to.z - TARGET.z) - Math.atan2(from.x - TARGET.x, from.z - TARGET.z),
    );
    expect(turned(first, second)).toBeCloseTo(SPIN_RADIANS_PER_SECOND * 0.1, 5);
    expect(turned(second, third)).toBeCloseTo(SPIN_RADIANS_PER_SECOND * 0.1, 5);
  });

  it('textures the live scene at the tile’s own resolution', async () => {
    const { live, loadTexture } = preview();

    await live.show(VISUAL.name, host, 96);
    await Promise.resolve();

    expect(loadTexture).toHaveBeenCalledWith('NW_WOOD.TGA', THUMBNAIL_TEXTURE_SIZE);
  });

  it('leaves the still alone for a name the binding cannot extract', async () => {
    const { live } = preview();

    await live.show('NOT_A_MESH.MRM', host, 96);

    expect(host.contains(live.canvas)).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('drops a hover the pointer has already left', async () => {
    let resolveVisual: (visual: VisualScene) => void = () => {};
    const { live } = preview({
      loadVisual: () => new Promise<VisualScene | null>((resolve) => { resolveVisual = resolve; }),
    });

    const showing = live.show(VISUAL.name, host, 96);
    live.hide(host);
    resolveVisual(VISUAL);
    await showing;

    expect(host.contains(live.canvas)).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('stops the loop and takes the canvas back when the pointer leaves', async () => {
    const { live } = preview();
    await live.show(VISUAL.name, host, 96);
    tick(0);

    live.hide(host);

    expect(host.contains(live.canvas)).toBe(false);
    expect(cancelled).not.toHaveLength(0);
    expect(frames.size).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('hands the turn to the pointer while it is down, and gives it back', async () => {
    const { live } = preview();
    await live.show(VISUAL.name, host, 96);
    tick(0);

    live.beginDrag();
    tick(100);
    // A second of held pointer with no movement is a second of no turn.
    expect(positions[1].distanceTo(positions[0])).toBeCloseTo(0, 6);

    live.drag(40, 0);
    tick(200);
    expect(positions[2].distanceTo(positions[1])).toBeGreaterThan(0.01);
    expect(positions[2].distanceTo(TARGET)).toBeCloseTo(positions[1].distanceTo(TARGET), 5);

    live.endDrag();
    tick(300);
    expect(positions[3].distanceTo(positions[2])).toBeGreaterThan(0.01);
  });

  it('extracts a re-hovered name once', async () => {
    const { live, loadVisual } = preview();

    await live.show(VISUAL.name, host, 96);
    live.hide(host);
    await live.show(VISUAL.name, host, 96);

    expect(loadVisual).toHaveBeenCalledTimes(1);
    expect(host.contains(live.canvas)).toBe(true);
  });

  it('disposes the scene and the context', async () => {
    const { live } = preview();
    const disposeRenderer = jest.spyOn(THREE.WebGLRenderer.prototype, 'dispose');
    await live.show(VISUAL.name, host, 96);
    tick(0);

    live.dispose();

    expect(host.contains(live.canvas)).toBe(false);
    expect(disposeRenderer).toHaveBeenCalled();
  });
});
