/**
 * What a selection looks like in the viewport, and what a click can reach
 * (level-editor.md §16.24 1, 2 and 3) — the three findings from Daniel's first
 * real sessions that live on this side of the props.
 *
 *   - the selected VOBs carry the per-instance flag their shader reads, so a
 *     selection is visible without its gizmo being on screen
 *   - the translate gizmo stands in the middle of the selection, and the rotate
 *     gizmo still stands on the last VOB picked — because `rotateVobs` turns
 *     each VOB about its own origin and a centroid pivot is one the op does not
 *     use
 *   - the world mesh is handed to the pick pass as a depth-only occluder, so a
 *     VOB behind a wall does not win the pixel
 *
 * Only what jsdom genuinely cannot run is faked, via `worldViewportMocks.ts`.
 * `WorldScene` and the gizmo wiring are the real ones.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import type * as THREE from 'three';
import type { InstancedPayload, WorldMeshPayload } from '../src/shared/worldTypes';
// Named `mock*` — that prefix is what lets a `jest.mock()` factory below
// reference it despite jest.mock() being hoisted above other imports.
import * as mockWorldViewport from './worldViewportMocks';

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());

/** The picker, watched: what the viewport hands it is the whole assertion for
 *  the occluder, since the pass itself needs a GPU. */
const mockOccluders = jest.fn();
jest.mock('../src/renderer/world/VobPicker', () => ({
  VobPicker: class {
    setInstancedMeshes() {}
    setWorldMeshes(...args: unknown[]) { mockOccluders(...args); }
    warm() {}
    pickAsync() { return Promise.resolve(-1); }
    dispose() {}
  },
}));

import { ROOT_MATRIX } from 'zen-world';
import WorldViewport from '../src/renderer/components/world/WorldViewport';

/** One draw group, so the world mesh payload builds a real `THREE.Mesh`. */
const GROUP = {
  texture: 'NW_WOOD.TGA',
  color: [255, 255, 255, 255] as [number, number, number, number],
  alphaFunc: 0,
  texAniMapMode: 0,
  texAniFps: 0,
  texAniMapDir: [0, 0] as [number, number],
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
};

const MESH: WorldMeshPayload = { groups: [GROUP], bbox: [0, 0, 0, 100, 100, 100] };
const BBOX = [0, 0, 0, 100, 100, 100];

/** VOB 7 at [10, 20, 30] and VOB 9 at [40, 50, 60] — two drawn VOBs, so a
 *  multi-selection has a middle that is neither of them. */
function instancedPayload(): InstancedPayload {
  return {
    visuals: [{
      name: 'BARREL.3DS',
      source: 'BARREL.MRM',
      count: 2,
      matrices: new Float32Array([
        1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30,
        1, 0, 0, 40, 0, 1, 0, 50, 0, 0, 1, 60,
      ]).buffer,
      vobIds: new Uint32Array([7, 9]).buffer,
      groups: [GROUP],
      bounds: [0, 0, 0, 100, 100, 0],
    }],
    stats: {
      visualsSeen: 1,
      visualsResolved: 1,
      vobsPlaced: 2,
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
    snapGrid: 0,
    snapAngle: 0,
    onSelectWaypoint: () => {},
    onMoveWaypoint: () => {},
    ...overrides,
  };
}


describe('WorldViewport — the selection is visible on the VOBs themselves', () => {
  beforeEach(() => {
    mockOccluders.mockClear();
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('marks the selected instances, and clears them when the selection changes', () => {
    const { rerender, unmount } = render(<WorldViewport {...props({ selection: [9] })} />);

    expect(window.__worldViewport!.selectedInstances()).toEqual([0, 1]);

    rerender(<WorldViewport {...props({ selection: [7] })} />);
    expect(window.__worldViewport!.selectedInstances()).toEqual([1, 0]);

    rerender(<WorldViewport {...props({ selection: [] })} />);
    expect(window.__worldViewport!.selectedInstances()).toEqual([0, 0]);
    unmount();
  });

  it('marks a whole multi-selection, not just the one the gizmo is on', () => {
    // The complaint §16.24 1 is about: one gizmo, several selected VOBs, and
    // no way to tell which of them are in the batch a drag would move.
    const { unmount } = render(<WorldViewport {...props({ selection: [7, 9] })} />);
    expect(window.__worldViewport!.selectedInstances()).toEqual([1, 1]);
    unmount();
  });

  it('marks the selection again after a structural op rebuilds the scene', () => {
    // A fresh `WorldScene` starts with nothing selected — the same hazard the
    // exposure and the hidden flags already carry.
    const { rerender, unmount } = render(<WorldViewport {...props({ selection: [7] })} />);
    rerender(<WorldViewport {...props({ selection: [7] })} />);
    expect(window.__worldViewport!.selectedInstances()).toEqual([1, 0]);
    unmount();
  });
});

describe('WorldViewport — where the gizmo stands for a multi-selection', () => {
  beforeEach(() => {
    mockOccluders.mockClear();
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('puts the translate gizmo in the middle of the selection', () => {
    const { unmount } = render(<WorldViewport {...props({ selection: [7, 9] })} />);
    expect(window.__worldViewport!.gizmoPosition()).toEqual([25, 35, 45]);
    unmount();
  });

  it('leaves the rotate gizmo on the last VOB picked', () => {
    // Deliberate: `rotateVobs` turns each VOB about its own origin, so a gizmo
    // at the centroid would show a pivot the op does not use and the first
    // multi-VOB rotate would look broken.
    const { unmount } = render(
      <WorldViewport {...props({ selection: [7, 9], gizmoMode: 'rotate' })} />,
    );
    expect(window.__worldViewport!.gizmoPosition()).toEqual([40, 50, 60]);
    unmount();
  });

  it('moves the gizmo when the mode changes under a standing selection', () => {
    // W and E switch mode without touching the selection, so the anchor has to
    // follow the mode rather than only the selection.
    const { rerender, unmount } = render(
      <WorldViewport {...props({ selection: [7, 9], gizmoMode: 'rotate' })} />,
    );
    expect(window.__worldViewport!.gizmoPosition()).toEqual([40, 50, 60]);

    rerender(<WorldViewport {...props({ selection: [7, 9], gizmoMode: 'translate' })} />);
    expect(window.__worldViewport!.gizmoPosition()).toEqual([25, 35, 45]);
    unmount();
  });

  it('hands the shell the same delta wherever the gizmo stands', () => {
    // The op is built from where each VOB *was*, and the drag reports a delta
    // from where the proxy was picked up — so moving the anchor must not change
    // a single op.
    const deltas: Array<[number, number, number]> = [];
    const { unmount } = render(<WorldViewport {...props({
      selection: [7, 9],
      onTranslateSelection: (delta: [number, number, number]) => deltas.push(delta),
    })} />);

    act(() => { window.__worldViewport!.dragGizmo([35, 35, 45]); });

    expect(deltas).toEqual([[10, 0, 0]]);
    unmount();
  });
});

describe('WorldViewport — the pick pass is given something to hide behind', () => {
  beforeEach(() => {
    mockOccluders.mockClear();
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('hands the world mesh to the picker with the scene root', () => {
    // §16.24 3: the pick scene held the VOB proxies and nothing else, so no
    // world geometry wrote depth and a VOB behind a wall won the pixel.
    const { unmount } = render(<WorldViewport {...props()} />);

    expect(mockOccluders).toHaveBeenCalledTimes(1);
    const [meshes, root] = mockOccluders.mock.calls[0] as [THREE.Mesh[], THREE.Matrix4];
    expect(meshes).toHaveLength(1);
    expect((meshes[0] as unknown as { isMesh: boolean }).isMesh).toBe(true);
    // The same root the proxies carry — an occluder in the wrong space is
    // worse than no occluder at all.
    expect([...root.elements]).toEqual([...ROOT_MATRIX]);
    unmount();
  });
});
