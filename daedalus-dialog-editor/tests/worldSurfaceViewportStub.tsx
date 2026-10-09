import React from 'react';
import { type WorldOp, type ZenRotation } from 'zen-world';
import { type WaynetPayload } from '../src/shared/worldTypes';
import { BASE_PROPS, WAYPOINT_TO, WAYPOINT_WAS } from './worldFixtures';

/**
 * The stubbed `WorldViewport` the `WorldSurface.editing.*` suites render
 * behind, and what it was last handed. A module of its own, not part of
 * `worldSurfaceEditingHarness.tsx`, because the harness imports `WorldSurface`
 * and so the viewport: a mock factory reaching back into it would run while
 * it is still loading. Each suite registers the mocks itself, since `jest.mock`
 * is hoisted per file:
 *
 *   import * as mockViewportStub from './worldSurfaceViewportStub';
 *   jest.mock('../src/renderer/components/world/WorldViewport', () => mockViewportStub.viewportStubModule());
 */

/** The drag the stub fires — VOB 1 sits at [10, 20, 30], so this is `MOVE`. */
export const DRAG: [number, number, number] = [1, 2, 3];
/** The viewport's imperative raycast — drop-to-ground and align-to-normal's
 *  only way to ask it anything. A `jest.fn` rather than a fixed answer, so
 *  each test says what the ray hits. */
export const mockRaycastDown = jest.fn() as jest.Mock<
  { point: [number, number, number]; normal: [number, number, number] } | null,
  [[number, number, number]]
>;
/** The viewport's other imperative command: the camera jump the scene tree's
 *  double-click asks for. */
export const mockFrameVob = jest.fn() as jest.Mock<void, [number]>;
/** And the same jump onto a bare position — what a waypoint gets, having no
 *  row in the VOB index (§16.20 slice 2). */
export const mockFramePoint = jest.fn() as jest.Mock<void, [[number, number, number]]>;
export const mockFramePolygon = jest.fn() as jest.Mock<
  void, [readonly (readonly [number, number, number])[]]
>;
/** A quarter turn about Y, row-major — asymmetric, so a transpose would show. */
export const TURN: number[] = [0, 0, 1, 0, 1, 0, -1, 0, 0];
/** The pose every VOB in the fixture index has. */
export const IDENTITY: ZenRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * What the stubbed viewport was last handed, one field per prop a test reads.
 * Fields rather than module `let`s because the split suites import it, and an
 * imported binding cannot be reassigned.
 */
export const vp = {
  appliedOps: undefined as WorldOp[] | null | undefined,
  selection: undefined as readonly number[] | undefined,
  gizmoMode: undefined as string | undefined,
  selectedWaypoint: undefined as number | null | undefined,
  /** What the viewport is told to draw a marker at. */
  terrainPoint: undefined as [number, number, number] | null | undefined,
  /** How bright the viewport is told to draw. */
  exposure: undefined as number | undefined,
  /** Which VOBs the viewport is told not to draw — one byte per VOB, or null. */
  hiddenVobs: undefined as Uint8Array | null | undefined,
  /** The volume the viewport is told to draw round the selection (#248) — a
   *  sphere or a box — or null when the selected VOB is neither. */
  selectedExtent: undefined as { vob: number; extent: Record<string, unknown> } | null | undefined,
  /** The payload the overlay draws, and the one a committed waypoint drag builds
   *  its op out of. */
  waynet: undefined as WaynetPayload | null | undefined,
  /** Whether the viewport is told to draw the waynet overlay. */
  showWaynet: undefined as boolean | undefined,
  /** The spawn markers the viewport is told to draw, and whether to show them. */
  spawns: undefined as readonly unknown[] | undefined,
  showSpawns: undefined as boolean | undefined,
  /** The routine index the viewport is handed, and the minute it draws — null is
   *  the time slider switched off, which is the static spawns. */
  routines: undefined as { sites: readonly unknown[]; routinesByNpc: Record<string, string> } | undefined,
  spawnTime: undefined as number | null | undefined,
  spawnState: undefined as string | null | undefined,
  /** Whether the viewport is told to draw waypoint names over the world. */
  showWaypointNames: undefined as boolean | undefined,
  /** The steps the viewport is told to quantise a drag to. */
  snapGrid: undefined as number | undefined,
  snapAngle: undefined as number | undefined,
  /**
   * What the per-class read answers, in the shape the binding sends it: the whole
   * props object, base fields and all. A mutable module-level value rather than a
   * `mockResolvedValue`, because the read is re-issued on every applied batch and
   * an implementation set in one test would outlive it — `clearAllMocks` clears
   * calls, not implementations.
   */
  vobProps: { class: 'zCVob', ...BASE_PROPS } as Record<string, unknown>,
};

// The house pattern for react-window under jsdom, which has no layout — without
// it the scene tree renders no rows at all and the drag-and-drop test below has
// nothing to drag.
export const autoSizerStub = (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 });


export function viewportStubModule() {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
  __esModule: true,
  default: ReactActual.forwardRef((props: {
    onTranslateSelection: (delta: [number, number, number]) => void;
    onRotateSelection: (delta: number[]) => void;
    onPick: (
      vob: number | null,
      point: [number, number, number] | null,
      additive: boolean,
    ) => void;
    gizmoMode: string;
    selection: readonly number[];
    appliedOps: WorldOp[] | null;
    selectedWaypoint: number | null;
    terrainPoint: [number, number, number] | null;
    exposure: number;
    hiddenVobs: Uint8Array | null;
    selectedExtent: { vob: number; extent: Record<string, unknown> } | null;
    snapGrid: number;
    snapAngle: number;
    waynet: WaynetPayload | null;
    showWaynet: boolean;
    spawns: readonly unknown[];
    showSpawns: boolean;
    routines: { sites: readonly unknown[]; routinesByNpc: Record<string, string> };
    spawnTime: number | null;
    showWaypointNames: boolean;
    onSelectWaypoint: (waypoint: number | null) => void;
    onMoveWaypoint: (
      waypoint: number,
      from: [number, number, number],
      to: [number, number, number],
    ) => void;
  }, ref: React.Ref<{
    raycastDown: typeof mockRaycastDown; frameVob: typeof mockFrameVob;
    framePoint: typeof mockFramePoint; framePolygon: typeof mockFramePolygon;
  }>) => {
    vp.appliedOps = props.appliedOps;
    vp.selection = props.selection;
    vp.gizmoMode = props.gizmoMode;
    vp.selectedWaypoint = props.selectedWaypoint;
    vp.terrainPoint = props.terrainPoint;
    vp.exposure = props.exposure;
    vp.hiddenVobs = props.hiddenVobs;
    vp.selectedExtent = props.selectedExtent;
    vp.snapGrid = props.snapGrid;
    vp.snapAngle = props.snapAngle;
    vp.waynet = props.waynet;
    vp.showWaynet = props.showWaynet;
    vp.spawns = props.spawns;
    vp.showSpawns = props.showSpawns;
    vp.routines = props.routines;
    vp.spawnTime = props.spawnTime;
    vp.spawnState = props.spawnState;
    vp.showWaypointNames = props.showWaypointNames;
    // The imperative surface drop-to-ground, align-to-normal and the scene
    // tree's camera jump call directly — see `WorldViewportHandle`'s doc —
    // stood in by jest.fns so the shell side can be tested without a WebGL
    // raycast or a real camera.
    ReactActual.useImperativeHandle(ref, () => ({
      raycastDown: mockRaycastDown, frameVob: mockFrameVob, framePoint: mockFramePoint,
      framePolygon: mockFramePolygon,
    }));
    return (
      <div data-testid="world-viewport-stub">
        <button type="button" data-testid="stub-drag" onClick={() => props.onTranslateSelection(DRAG)}>
          drag
        </button>
        {/* The waynet overlay's own pick, and its own drag. The viewport reports
            `from` as well as `to` because it recorded where the waypoint was
            when the drag began — its live preview has since written that
            position out of the payload, which is the array the op would
            otherwise read `from` out of. */}
        <button type="button" data-testid="stub-pick-waypoint" onClick={() => props.onSelectWaypoint(1)}>
          pick waypoint
        </button>
        <button
          type="button"
          data-testid="stub-drag-waypoint"
          onClick={() => props.onMoveWaypoint(1, WAYPOINT_WAS, WAYPOINT_TO)}
        >
          drag waypoint
        </button>
        <button type="button" data-testid="stub-turn" onClick={() => props.onRotateSelection(TURN)}>
          turn
        </button>
        {/* A click that hit the world mesh rather than a VOB: terrain is not a
            VOB, so it reports a point and no selection. That point is where a
            placed VOB goes. */}
        <button type="button" data-testid="stub-pick-terrain" onClick={() => props.onPick(null, TERRAIN, false)}>
          pick terrain
        </button>
        {/* And a click that hit a VOB: it selects, and reports no point — the
            ground the last pick chose is no longer what a placement would use. */}
        <button type="button" data-testid="stub-pick-vob" onClick={() => props.onPick(1, null, false)}>
          pick vob
        </button>
      </div>
    );
  }),
  };
}

/** Where a terrain click lands — ZenGin centimetres, deliberately not round. */
export const TERRAIN: [number, number, number] = [1500.5, -220, 3300.25];
