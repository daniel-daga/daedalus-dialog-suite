/**
 * The scatter brush against the real world mesh (level-editor.md §16.25).
 *
 * Every other scatter spec mocks the viewport away and calls `onScatterStroke`
 * itself — `WorldSurface.scatter.test.tsx` does exactly that — so the whole of
 * what the viewport contributes, turning a pointer into a point on the world,
 * was covered by nothing. It was also broken: the brush's raycaster was the one
 * of the three that never enabled `WORLD_LAYER`, which is the layer every world
 * mesh draws on, so `intersectObjects` skipped them all and no press ever
 * started a stroke.
 *
 * This drives the real handlers against a real `three` (only the GL renderer is
 * stubbed) and a ground quad the camera is framed on, so a press at the middle
 * of the canvas is a press on the world.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import type { DrawGroup, InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls({ aims: true }));
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker(-1));

import WorldViewport from '../src/renderer/components/world/WorldViewport';

/** A 100 x 100 m ground quad centred on the origin, wound so it faces the
 *  camera framed above it — the scene's root mirrors X (ZenGin is left-handed),
 *  which is what decides which winding that is, and the material is FrontSide. */
const GROUND: DrawGroup = {
  texture: 'NW_NATURE_GRASS.TGA',
  color: [255, 255, 255, 255],
  alphaFunc: 0,
  texAniMapMode: 0,
  texAniFps: 0,
  texAniMapDir: [0, 0],
  envMapping: false,
  envMappingStrength: 0,
  waveMode: 0,
  waveSpeed: 0,
  waveMaxAmplitude: 0,
  waveGridSize: 0,
  ignoreSun: false,
  disableLightmap: false,
  materials: 1,
  vertexCount: 4,
  triangleCount: 2,
  positions: new Float32Array([
    -5000, 0, -5000,
    -5000, 0, 5000,
    5000, 0, 5000,
    5000, 0, -5000,
  ]).buffer,
  normals: new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]).buffer,
  uvs: new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]).buffer,
  indices: new Uint32Array([0, 2, 1, 0, 3, 2]).buffer,
  lights: null,
};

const MESH: WorldMeshPayload = { groups: [GROUND], bbox: [-5000, 0, -5000, 5000, 0, 5000] };

const NO_VISUALS: InstancedPayload = {
  visuals: [],
  stats: {
    visualsSeen: 0,
    visualsResolved: 0,
    vobsPlaced: 0,
    instancedDrawGroups: 0,
    levelCompos: 0,
    unresolvedByType: {},
  },
};

function props(onScatterStroke: (samples: Array<[number, number, number]>) => void) {
  return {
    mesh: MESH,
    visuals: NO_VISUALS,
    bbox: MESH.bbox,
    waynet: null,
    showWaynet: false,
    spawns: [],
    showSpawns: false,
    loadTexture: async () => null,
    onPick: () => {},
    selection: [] as readonly number[],
    onTranslateSelection: () => {},
    gizmoMode: 'translate' as const,
    onRotateSelection: () => {},
    appliedOps: null,
    selectedWaypoint: null,
    terrainPoint: null,
    exposure: 1,
    hiddenVobs: null,
    snapGrid: 0,
    snapAngle: 0,
    scatterRadius: 300,
    onScatterStroke,
    onSelectWaypoint: () => {},
    onMoveWaypoint: () => {},
    paused: false,
  };
}

/** jsdom lays nothing out, so the canvas has no rect of its own to turn a
 *  client coordinate into NDC with. 800x600 at the origin is enough for the
 *  middle of the canvas to be the middle of the frustum. */
const RECT = {
  x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
  toJSON: () => ({}),
} as DOMRect;

/** A press, a drag and a release across the middle of the canvas. */
function paintAcross(canvas: HTMLCanvasElement): void {
  const press = { button: 0, bubbles: true, clientX: 400, clientY: 300 };
  canvas.dispatchEvent(new MouseEvent('pointerdown', press));
  window.dispatchEvent(new MouseEvent('pointermove', { ...press, clientX: 430 }));
  window.dispatchEvent(new MouseEvent('pointerup', { ...press, clientX: 430 }));
}

describe('WorldViewport — the scatter brush meets the world mesh', () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    HTMLCanvasElement.prototype.getBoundingClientRect = () => RECT;
    // jsdom implements no pointer capture; the stroke takes and releases it.
    const element = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
    element.setPointerCapture = () => {};
    element.releasePointerCapture = () => {};
    element.hasPointerCapture = () => false;
  });

  it('reports a stroke painted over the world mesh', () => {
    const strokes: Array<Array<[number, number, number]>> = [];
    const { container, unmount } = render(<WorldViewport {...props((s) => strokes.push(s))} />);

    // Home frames the camera on the world, so the middle of the canvas is a ray
    // at the middle of the ground quad — the aiming controls above are what
    // carry the framing onto the camera, as the real ones do.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' })); });

    act(() => { paintAcross(container.querySelector('canvas')!); });

    expect(strokes).toHaveLength(1);
    // Every sample is a point on the quad: y is the ground's own height, and x
    // and z are inside it.
    for (const [x, y, z] of strokes[0]) {
      expect(y).toBeCloseTo(0, 3);
      expect(Math.abs(x)).toBeLessThanOrEqual(5000);
      expect(Math.abs(z)).toBeLessThanOrEqual(5000);
    }
    // The press and the move both sampled: a stroke that only ever reported its
    // first point would place one VOB however far the cursor was dragged.
    expect(strokes[0].length).toBeGreaterThan(1);
    unmount();
  });

  it('starts no stroke while the brush is off', () => {
    const strokes: Array<Array<[number, number, number]>> = [];
    const { container, unmount } = render(
      <WorldViewport {...props((s) => strokes.push(s))} scatterRadius={null} />,
    );

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' })); });
    act(() => { paintAcross(container.querySelector('canvas')!); });

    expect(strokes).toEqual([]);
    unmount();
  });
});
