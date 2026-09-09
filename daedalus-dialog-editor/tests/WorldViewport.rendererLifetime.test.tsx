/**
 * A structural op rebuilds the scene and nothing above it
 * (level-editor-review-2026-09-04 §3.2 and §4, #220).
 *
 * Placing a VOB cannot be applied to the columnar projection, so the viewport
 * re-reads the world and rebuilds `WorldScene` from it. It used to rebuild the
 * `WebGLRenderer` with it — a new GL context, a new canvas, a new outline pass
 * and new controls per placement — and since `dispose()` does not release a
 * context, the old one sat on its uploads until its detached canvas was
 * collected while the new one re-uploaded 490 textures, 31 MB of mesh and every
 * program. Against a browser cap of about sixteen contexts, and the
 * shader-compile cost §3 had moved off the first click.
 *
 * None of that has a picture to look at under jsdom, so what is pinned here is
 * the fact underneath it: across an op there is one renderer, one canvas and
 * one camera, and the camera is still pointing where the placement was aimed
 * from — which is the whole reason the view has to survive. A different world
 * is the one thing that does frame the camera afresh.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render } from '@testing-library/react';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
// Named `mock*` — that prefix is what lets a `jest.mock()` factory below
// reference it despite jest.mock() being hoisted above other imports.
import * as mockWorldViewport from './worldViewportMocks';

/** Every renderer the viewport has built, and whether it was disposed. */
const mockRenderers: Array<{ canvas: HTMLCanvasElement; disposed: number }> = [];

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => {
  const base = mockWorldViewport.mockThree();
  return {
    ...base,
    WebGLRenderer: class extends base.WebGLRenderer {
      private entry = { canvas: this.domElement, disposed: 0 };
      constructor(...args: unknown[]) {
        super(...(args as []));
        mockRenderers.push(this.entry);
      }

      dispose() { this.entry.disposed += 1; }
    },
  };
});
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker());

import WorldViewport, { type WorldViewportHandle } from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };
const BBOX = [0, 0, 0, 100, 100, 100];
/** A different world: another island, somewhere else, of another size. */
const OTHER_BBOX = [-800, -200, -800, 800, 600, 800];

/** VOB 7, drawn, at [10, 20, 30] in ZenGin centimetres — something to frame. */
function instancedPayload(): InstancedPayload {
  return {
    visuals: [{
      name: 'BARREL.3DS',
      source: 'BARREL.MRM',
      count: 1,
      matrices: new Float32Array([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]).buffer,
      vobIds: new Uint32Array([7]).buffer,
      groups: [{
        texture: 'NW_WOOD.TGA',
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
        vertexCount: 3,
        triangleCount: 1,
        positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]).buffer,
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer,
        uvs: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
        indices: new Uint32Array([0, 1, 2]).buffer,
        lights: null,
      }],
      bounds: [0, 0, 0, 100, 100, 0],
    }],
    stats: {
      visualsSeen: 1,
      visualsResolved: 1,
      vobsPlaced: 1,
      instancedDrawGroups: 1,
      levelCompos: 0,
      unresolvedByType: {},
    },
  };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    mesh: MESH,
    visuals: instancedPayload(),
    bbox: BBOX,
    waynet: null,
    showWaynet: false,
    spawns: [],
    showSpawns: false,
    routines: { sites: [], routinesByNpc: {} },
    spawnTime: null,
    spawnState: null,
    showWaypointNames: false,
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
    outlineMode: 'all' as const,
    snapGrid: 0,
    snapAngle: 0,
    scatterRadius: null,
    onScatterStroke: () => {},
    onSelectWaypoint: () => {},
    onMoveWaypoint: () => {},
    ...overrides,
  };
}

/** What the World surface does after an edit: the same world, re-read. The
 *  bbox comes back structured-cloned, so it is a fresh array of equal numbers —
 *  which is exactly what used to make this a rebuild. */
const structuralOp = () => props({ visuals: instancedPayload(), bbox: [...BBOX] });

describe('WorldViewport — what a structural op does not rebuild', () => {
  beforeEach(() => {
    mockRenderers.length = 0;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('keeps its renderer, its GL context and its canvas across the rebuild', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { rerender, unmount } = render(<WorldViewport {...props()} />, { container: host });

    expect(mockRenderers).toHaveLength(1);
    const canvas = mockRenderers[0].canvas;
    expect(canvas.isConnected).toBe(true);

    rerender(<WorldViewport {...structuralOp()} />);

    expect(mockRenderers).toHaveLength(1);
    expect(mockRenderers[0].disposed).toBe(0);
    expect(mockRenderers[0].canvas).toBe(canvas);
    expect(canvas.isConnected).toBe(true);

    // And it does go when the viewport does — the context is released with the
    // world, not kept for a surface nobody is looking at.
    unmount();
    expect(mockRenderers[0].disposed).toBe(1);
    expect(canvas.isConnected).toBe(false);
  });

  it('leaves the camera where the placement was aimed from', () => {
    const ref = React.createRef<WorldViewportHandle>();
    const { rerender, unmount } = render(<WorldViewport ref={ref} {...props()} />);

    // Somewhere that is not the opening frame: the view a user placed a VOB
    // from.
    ref.current!.frameVob(7);
    const aimed = window.__worldViewport!.cameraPosition();
    const pivot = window.__worldViewport!.cameraTarget();

    rerender(<WorldViewport ref={ref} {...structuralOp()} />);

    expect(window.__worldViewport!.cameraPosition()).toEqual(aimed);
    expect(window.__worldViewport!.cameraTarget()).toEqual(pivot);
    unmount();
  });

  it('frames a different world afresh', () => {
    // The one case that must still move the camera: keeping the pose would open
    // another island from wherever the last one was being looked at.
    const ref = React.createRef<WorldViewportHandle>();
    const { rerender, unmount } = render(<WorldViewport ref={ref} {...props()} />);

    ref.current!.frameVob(7);
    const aimed = window.__worldViewport!.cameraPosition();

    rerender(<WorldViewport ref={ref} {...props({
      visuals: instancedPayload(), bbox: OTHER_BBOX,
    })} />);

    expect(window.__worldViewport!.cameraPosition()).not.toEqual(aimed);
    // On the new world's own middle, in ZenGin space.
    const pivot = window.__worldViewport!.cameraTarget();
    expect(pivot[0]).toBeCloseTo(0, 3);
    expect(pivot[1]).toBeCloseTo(200, 3);
    expect(pivot[2]).toBeCloseTo(0, 3);
    unmount();
  });
});
