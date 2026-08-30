/**
 * The waynet overlay must survive the scene rebuild a structural op forces.
 *
 * The overlay hangs its group off the scene root, and the scene root is built
 * inside the viewport's big scene effect — which re-runs whenever `visuals`
 * changes, because a structural op (placing, deleting or reparenting a VOB)
 * cannot be applied to the columnar projection and is answered by rebuilding
 * from a fresh instanced payload. If the overlay's own effect does not take
 * `visuals` too, the rebuild hands out a new root while the overlay stays
 * attached to the disposed one: the waynet silently vanishes until it is
 * toggled off and on. The terrain marker's effect already takes `visuals` for
 * exactly this reason.
 *
 * Only what the viewport genuinely cannot have under jsdom is faked here, via
 * the shared `worldViewportMocks.ts` — the WebGL renderer, the two example
 * controls (ESM, and neither has anything to say about the scene graph), the
 * BVH worker and the GPU picker. `WorldScene` and `WaynetOverlay` are the real
 * classes, so the assertion below is about the real scene graph: after a
 * `visuals`-only rebuild the overlay's group must be a child of the *current*
 * root, not of the disposed one.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, act } from '@testing-library/react';
import * as THREE from 'three';
import type { InstancedPayload, WaynetPayload, WorldMeshPayload } from '../src/shared/worldTypes';
// Named `mock*` — that prefix is what lets a `jest.mock()` factory below
// reference it despite jest.mock() being hoisted above other imports.
import * as mockWorldViewport from './worldViewportMocks';

// ── what jsdom cannot run ───────────────────────────────────────────────────
// See worldViewportMocks.ts for what each stand-in provides.

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker());

// ── the two real classes, recorded as they are built ────────────────────────

const mockScenes: Array<{ root: THREE.Object3D }> = [];
jest.mock('../src/renderer/world/WorldScene', () => {
  const actual = jest.requireActual('../src/renderer/world/WorldScene');
  return {
    ...actual,
    WorldScene: class extends actual.WorldScene {
      constructor(...args: unknown[]) {
        super(...args);
        mockScenes.push(this as unknown as { root: THREE.Object3D });
      }
    },
  };
});

const mockOverlays: Array<{ root: THREE.Object3D }> = [];
jest.mock('../src/renderer/world/WaynetOverlay', () => {
  const actual = jest.requireActual('../src/renderer/world/WaynetOverlay');
  return {
    ...actual,
    WaynetOverlay: class extends actual.WaynetOverlay {
      constructor(...args: unknown[]) {
        super(...args);
        mockOverlays.push(this as unknown as { root: THREE.Object3D });
      }
    },
  };
});

const mockSpawnOverlays: Array<{ root: THREE.Object3D }> = [];
jest.mock('../src/renderer/world/SpawnOverlay', () => {
  const actual = jest.requireActual('../src/renderer/world/SpawnOverlay');
  return {
    ...actual,
    SpawnOverlay: class extends actual.SpawnOverlay {
      constructor(...args: unknown[]) {
        super(...args);
        mockSpawnOverlays.push(this as unknown as { root: THREE.Object3D });
      }
    },
  };
});

// Below the mocks, which jest hoists above it anyway.
import WorldViewport from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };
const BBOX = [0, 0, 0, 100, 100, 100];

function instancedPayload(): InstancedPayload {
  return {
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
}

/** Two waypoints joined by one edge — enough for a real overlay. */
function waynet(): WaynetPayload {
  return {
    count: 2,
    names: ['A', 'B'],
    positions: new Float32Array([0, 0, 0, 100, 0, 100]).buffer,
    directions: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
    waterDepths: new Float32Array([0, 0]).buffer,
    flags: new Uint32Array([0, 0]).buffer,
    edgeCount: 1,
    edges: new Uint32Array([0, 1]).buffer,
    danglingEdges: 0,
  };
}

/** One spawn, on the fixture waynet's second waypoint. */
const SPAWNS = [{
  instance: 'GRD_200_XARDAS', spawnPoint: 'B',
  filePath: 'C:/Story/Startup.d', functionName: 'STARTUP_NEWWORLD', line: 12,
}];

function props(visuals: InstancedPayload, payload: WaynetPayload, showWaynet: boolean) {
  return {
    mesh: MESH,
    visuals,
    bbox: BBOX,
    waynet: payload,
    showWaynet,
    spawns: SPAWNS,
    showSpawns: true,
    routines: { sites: [], routinesByNpc: {} },
    spawnTime: null,
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
    onSelectWaypoint: () => {},
    onMoveWaypoint: () => {},
  };
}

describe('WorldViewport — the waynet overlay across a structural rebuild', () => {
  beforeEach(() => {
    mockScenes.length = 0;
    mockOverlays.length = 0;
    mockSpawnOverlays.length = 0;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('re-attaches the overlay to the root a visuals-only rebuild hands out', () => {
    const payload = waynet();
    const { rerender, unmount } = render(
      <WorldViewport {...props(instancedPayload(), payload, true)} />,
    );

    expect(mockScenes).toHaveLength(1);
    expect(mockOverlays).toHaveLength(1);
    expect(mockOverlays[0].root.parent).toBe(mockScenes[0].root);

    // A structural op: the same world, the same waynet, a fresh instanced
    // payload — which is what the World surface re-requests and hands down.
    act(() => {
      rerender(<WorldViewport {...props(instancedPayload(), payload, true)} />);
    });

    // The scene really was rebuilt, or there is nothing here to get wrong.
    expect(mockScenes).toHaveLength(2);
    expect(mockScenes[1].root).not.toBe(mockScenes[0].root);

    // And the waynet is drawn under the root that is now on screen. Attached to
    // the disposed one it is invisible until the overlay is toggled off and on.
    const overlay = mockOverlays[mockOverlays.length - 1];
    expect(overlay.root.parent).toBe(mockScenes[1].root);
    expect(mockScenes[0].root.children).toHaveLength(0);

    unmount();
  });

  it('leaves a shown waynet on screen across that rebuild', () => {
    const payload = waynet();
    const { rerender, unmount } = render(
      <WorldViewport {...props(instancedPayload(), payload, true)} />,
    );
    expect(mockOverlays[0].root.visible).toBe(true);

    act(() => {
      rerender(<WorldViewport {...props(instancedPayload(), payload, true)} />);
    });

    // A rebuilt overlay is a fresh one and `WaynetOverlay` starts hidden, so
    // the visibility effect has to follow the rebuild as well as the attachment
    // — re-attached but never shown is the same vanished waynet.
    expect(mockOverlays).toHaveLength(2);
    const overlay = mockOverlays[mockOverlays.length - 1];
    expect(overlay.root.visible).toBe(true);

    unmount();
  });

  it('re-attaches the spawn markers to that root too, and leaves them shown', () => {
    // §16.19 slice 4. The markers hang off the same root and their effect takes
    // `visuals` for the same reason the waynet's does — attached to the disposed
    // root, or rebuilt hidden, the layer silently vanishes and reads exactly
    // like a project that spawns nobody in this world.
    const payload = waynet();
    const { rerender, unmount } = render(
      <WorldViewport {...props(instancedPayload(), payload, false)} />,
    );
    expect(mockSpawnOverlays).toHaveLength(1);
    expect(mockSpawnOverlays[0].root.visible).toBe(true);

    act(() => {
      rerender(<WorldViewport {...props(instancedPayload(), payload, false)} />);
    });

    expect(mockSpawnOverlays).toHaveLength(2);
    const overlay = mockSpawnOverlays[mockSpawnOverlays.length - 1];
    expect(overlay.root.parent).toBe(mockScenes[1].root);
    expect(overlay.root.visible).toBe(true);

    unmount();
  });
});
