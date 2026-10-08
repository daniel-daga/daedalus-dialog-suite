/**
 * The overlays across a structural op.
 *
 * The waynet, the spawn markers and routine mode's draft hang their groups off
 * the scene root. A structural op (placing, deleting or reparenting a VOB) used
 * to rebuild the scene from a fresh instanced payload, which handed out a new
 * root — so each overlay's effect took `visuals` and was rebuilt with it, the
 * spawn markers re-fetching every NPC body each time. The scene now follows the
 * op in place (`SceneHost.update`) and the root survives, so each overlay is
 * built once per world and stays where it is, shown.
 *
 * Only what the viewport genuinely cannot have under jsdom is faked here, via
 * the shared `worldViewportMocks.ts` — the WebGL renderer, the two example
 * controls (ESM, and neither has anything to say about the scene graph), the
 * BVH worker and the GPU picker. `WorldScene` and the overlays are the real
 * classes, so the assertions are about the real scene graph.
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

const mockRoutineOverlays: Array<{ root: THREE.Object3D }> = [];
jest.mock('../src/renderer/world/RoutineOverlay', () => {
  const actual = jest.requireActual('../src/renderer/world/RoutineOverlay');
  return {
    ...actual,
    RoutineOverlay: class extends actual.RoutineOverlay {
      constructor(...args: unknown[]) {
        super(...args);
        mockRoutineOverlays.push(this as unknown as { root: THREE.Object3D });
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
    // Nothing about a decal here; `DecalLayer.test.ts` is where one is drawn.
    decals: mockWorldViewport.noDecals(),
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

/** One object for every render, as the surface's is: the markers are rebuilt
 *  when it changes, and a fresh literal per render would rebuild them each time. */
const ROUTINES = { sites: [], routinesByNpc: {} };

function props(visuals: InstancedPayload, payload: WaynetPayload, showWaynet: boolean) {
  return {
    mesh: MESH,
    visuals,
    vobIndex: mockWorldViewport.noVobMarkers(),
    bbox: BBOX,
    waynet: payload,
    showWaynet,
    spawns: SPAWNS,
    showSpawns: true,
    routines: ROUTINES,
    spawnTime: null,
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
    onSelectWaypoint: () => {},
    onMoveWaypoint: () => {},
  };
}

describe('WorldViewport — the overlays across a structural op', () => {
  beforeEach(() => {
    mockScenes.length = 0;
    mockOverlays.length = 0;
    mockSpawnOverlays.length = 0;
    mockRoutineOverlays.length = 0;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('keeps the scene, and the waynet on its root', () => {
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

    expect(mockScenes).toHaveLength(1);
    expect(mockOverlays).toHaveLength(1);
    expect(mockOverlays[0].root.parent).toBe(mockScenes[0].root);

    unmount();
  });

  it('does not rebuild for a bbox array that is merely a new object', () => {
    // Every structural op re-reads the index, and the summary comes back
    // structured-cloned from the main process — so `summary.bbox`, which the
    // surface passes straight down, is a new array holding the same six
    // numbers. Keyed on the array's *identity* that was a whole extra rebuild:
    // renderer, canvas, scene, picker and 352 BVH trees thrown away and made
    // again, with the old GL context left holding its textures until the
    // detached canvas is collected. It ran first, too, with the *stale* visuals
    // — the real payload arrived one await later and rebuilt everything a
    // second time.
    const payload = waynet();
    const visuals = instancedPayload();
    const { rerender, unmount } = render(
      <WorldViewport {...props(visuals, payload, true)} bbox={[...BBOX]} />,
    );

    expect(mockScenes).toHaveLength(1);

    act(() => {
      rerender(<WorldViewport {...props(visuals, payload, true)} bbox={[...BBOX]} />);
    });

    expect(mockScenes).toHaveLength(1);

    // A different world still frames as a different world.
    act(() => {
      rerender(<WorldViewport {...props(visuals, payload, true)} bbox={[0, 0, 0, 900, 900, 900]} />);
    });

    expect(mockScenes).toHaveLength(2);
    unmount();
  });

  it('leaves a shown waynet on screen across it', () => {
    const payload = waynet();
    const { rerender, unmount } = render(
      <WorldViewport {...props(instancedPayload(), payload, true)} />,
    );
    expect(mockOverlays[0].root.visible).toBe(true);

    act(() => {
      rerender(<WorldViewport {...props(instancedPayload(), payload, true)} />);
    });

    expect(mockOverlays).toHaveLength(1);
    expect(mockOverlays[0].root.visible).toBe(true);

    unmount();
  });

  it('leaves the spawn markers built, attached and shown — no NPC body is fetched again', () => {
    // §16.19 slice 4. Rebuilt per op, the layer re-asked the worker for every
    // NPC body it draws and re-decoded their textures, for a placement that had
    // nothing to do with any of them.
    const payload = waynet();
    const { rerender, unmount } = render(
      <WorldViewport {...props(instancedPayload(), payload, false)} />,
    );
    expect(mockSpawnOverlays).toHaveLength(1);
    expect(mockSpawnOverlays[0].root.visible).toBe(true);

    act(() => {
      rerender(<WorldViewport {...props(instancedPayload(), payload, false)} />);
    });

    expect(mockSpawnOverlays).toHaveLength(1);
    expect(mockSpawnOverlays[0].root.parent).toBe(mockScenes[0].root);
    expect(mockSpawnOverlays[0].root.visible).toBe(true);

    unmount();
  });

  it('draws routine mode\'s draft under that root too, and takes it away when the mode closes', () => {
    // npc-editor.md §6: the draft's stops and routes hang off the same root.
    const payload = waynet();
    const draft = {
      entries: [
        { state: 'TA_Stand', startMinute: 8 * 60, endMinute: 20 * 60, waypoint: 'A' },
        { state: 'TA_Sleep', startMinute: 20 * 60, endMinute: 8 * 60, waypoint: 'B' },
      ],
      selected: null,
    };
    const { rerender, unmount } = render(
      <WorldViewport {...props(instancedPayload(), payload, true)} routineDraft={draft} />,
    );
    expect(mockRoutineOverlays).toHaveLength(1);
    expect(mockRoutineOverlays[0].root.parent).toBe(mockScenes[0].root);

    act(() => {
      rerender(<WorldViewport {...props(instancedPayload(), payload, true)} routineDraft={draft} />);
    });
    expect(mockRoutineOverlays).toHaveLength(1);
    expect(mockRoutineOverlays[0].root.parent).toBe(mockScenes[0].root);

    act(() => {
      rerender(<WorldViewport {...props(instancedPayload(), payload, true)} routineDraft={null} />);
    });
    expect(mockRoutineOverlays.every((overlay) => overlay.root.parent === null)).toBe(true);

    unmount();
  });
});
