/**
 * Framing a VOB is a command on the viewport's imperative handle
 * (`docs/refactoring-targets.md` §9), not a request prop: the shell calls
 * `frameVob` the way it already calls `raycastDown`, and the ref hop through
 * `frameVobRef` stays inside the component.
 *
 * What is pinned here is the seam the promotion moves — a command reaches the
 * framing closure the scene effect owns, with the VOB's own position and
 * bounds — plus the hazard §9 names: the handle outlives the scene effect, so
 * a command asked for while the scene is being rebuilt must be a no-op rather
 * than a crash. The framing maths itself is `frameVobs` in `cameraNav`, tested
 * against a real camera in `tests/cameraNav.test.ts`.
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

// ── what jsdom cannot run ───────────────────────────────────────────────────
// See worldViewportMocks.ts for what each stand-in provides.

jest.mock('three-mesh-bvh', () => mockWorldViewport.mockThreeMeshBvh());
jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());
jest.mock('three/examples/jsm/controls/TransformControls.js', () => mockWorldViewport.mockTransformControls());
jest.mock('../src/renderer/world/BvhBuilder', () => mockWorldViewport.mockBvhBuilder());
jest.mock('../src/renderer/world/VobPicker', () => mockWorldViewport.mockVobPicker());

/** The real framing, watched: what it is handed is what the command carried. */
const mockFramed = jest.fn();
jest.mock('../src/renderer/world/cameraNav', () => {
  const actual = jest.requireActual('../src/renderer/world/cameraNav');
  return {
    ...actual,
    frameVobs: (...args: unknown[]) => {
      mockFramed(...args);
      return (actual.frameVobs as (...a: unknown[]) => unknown)(...args);
    },
  };
});

import WorldViewport, { type WorldViewportHandle } from '../src/renderer/components/world/WorldViewport';

const MESH: WorldMeshPayload = { groups: [], bbox: [0, 0, 0, 100, 100, 100] };

/** VOB 7, drawn, at [10, 20, 30] in ZenGin centimetres. VOB 9 is *not* drawn —
 *  a decal or a sound VOB — so it has no position to frame. */
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

function props() {
  return {
    mesh: MESH,
    visuals: instancedPayload(),
    bbox: [0, 0, 0, 100, 100, 100],
    waynet: null,
    showWaynet: false,
    spawns: [],
    showSpawns: false,
    routines: { sites: [], routinesByNpc: {} },
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
    snapGrid: 0,
    snapAngle: 0,
    onSelectWaypoint: () => {},
    onMoveWaypoint: () => {},
  };
}

describe('WorldViewport — framing a VOB through the handle', () => {
  beforeEach(() => {
    mockFramed.mockClear();
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('frames the VOB the command names, with its own position and bounds', () => {
    const ref = React.createRef<WorldViewportHandle>();
    const { unmount } = render(<WorldViewport ref={ref} {...props()} />);

    ref.current!.frameVob(7);

    expect(mockFramed).toHaveBeenCalledTimes(1);
    // Third argument: the framable VOBs. One, VOB 7, at its own placement.
    expect(mockFramed.mock.calls[0][2]).toEqual([
      { at: [10, 20, 30], bounds: [0, 0, 0, 100, 100, 0] },
    ]);
    unmount();
  });

  it('is asked twice for two commands on the same VOB', () => {
    // The whole reason the old prop had to be a fresh object: jumping to the
    // same VOB twice is what is asked for after the camera has wandered off.
    const ref = React.createRef<WorldViewportHandle>();
    const { unmount } = render(<WorldViewport ref={ref} {...props()} />);

    ref.current!.frameVob(7);
    ref.current!.frameVob(7);

    expect(mockFramed).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('is a no-op for a VOB that is not drawn', () => {
    const ref = React.createRef<WorldViewportHandle>();
    const { unmount } = render(<WorldViewport ref={ref} {...props()} />);

    expect(() => ref.current!.frameVob(9)).not.toThrow();

    // Nothing framable reaches `frameVobs`, which moves no camera for an
    // empty list — the filter is in the closure, not in the command.
    expect(mockFramed.mock.calls[0][2]).toEqual([]);
    unmount();
  });

  it('is a no-op while the scene is being rebuilt', () => {
    // §9's hazard: the handle is alive whenever the component is, but the
    // closure it calls belongs to the scene effect, which re-runs on
    // `[mesh, visuals, bbox]`. A parent's layout effect runs *before* the
    // child's — which is exactly the window a command can land in.
    const seen: { threw: unknown } = { threw: null };
    function Parent() {
      const ref = React.useRef<WorldViewportHandle>(null);
      React.useLayoutEffect(() => {
        try {
          ref.current!.frameVob(7);
        } catch (error) {
          seen.threw = error;
        }
      }, []);
      return <WorldViewport ref={ref} {...props()} />;
    }

    const { unmount } = render(<Parent />);

    expect(seen.threw).toBeNull();
    expect(mockFramed).not.toHaveBeenCalled();
    unmount();
  });
});

describe('WorldViewport — framing a bare point through the handle', () => {
  // A waypoint is not a VOB — it has no row in the columnar index and no
  // bounds — so the Problems panel's jump to one (§16.20 slice 2) carries the
  // position itself. `frameVobs` already takes `bounds: null` for "a point
  // rather than a thing with a size"; this is the command that reaches it.
  beforeEach(() => {
    mockFramed.mockClear();
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  it('frames the point it is handed, with no bounds', () => {
    const ref = React.createRef<WorldViewportHandle>();
    const { unmount } = render(<WorldViewport ref={ref} {...props()} />);

    ref.current!.framePoint([1000, 40, -2000]);

    expect(mockFramed).toHaveBeenCalledTimes(1);
    expect(mockFramed.mock.calls[0][2]).toEqual([{ at: [1000, 40, -2000], bounds: null }]);
    unmount();
  });

  it('is a no-op while the scene is being rebuilt', () => {
    const seen: { threw: unknown } = { threw: null };
    function Parent() {
      const ref = React.useRef<WorldViewportHandle>(null);
      React.useLayoutEffect(() => {
        try {
          ref.current!.framePoint([1000, 40, -2000]);
        } catch (error) {
          seen.threw = error;
        }
      }, []);
      return <WorldViewport ref={ref} {...props()} />;
    }

    const { unmount } = render(<Parent />);

    expect(seen.threw).toBeNull();
    expect(mockFramed).not.toHaveBeenCalled();
    unmount();
  });
});
