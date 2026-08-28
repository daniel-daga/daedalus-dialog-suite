import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  createVobReader, eulerDeltaRotation, eulerToZenRotation, placeBounds,
  type VobIndex, type WorldOp, type ZenRotation,
} from 'zen-world';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { WaynetPayload, WorldSummary } from '../src/shared/worldTypes';

/**
 * The World surface's half of an edit (level-editor.md §7, Phase 1b).
 *
 * The shell owns the IPC — it always has — so it is where a drag becomes an op:
 * the viewport reports "this VOB now sits here" and the shell turns that into a
 * `MoveVob` against the index, sends it, and applies it to the projection only
 * once the main process has taken it.
 *
 * The viewport itself is stubbed. It needs a WebGL context and 31 MB of
 * payloads, and none of that is what these tests are about; the stub stands in
 * for the drag and for the gizmo, both of which are verified against the real
 * app by `scripts/verify-world-edit.js`.
 */

let mockAppliedOps: WorldOp[] | null | undefined;
let mockSelection: readonly number[] | undefined;
/** The drag the stub fires — VOB 1 sits at [10, 20, 30], so this is `MOVE`. */
const DRAG: [number, number, number] = [1, 2, 3];
let mockGizmoMode: string | undefined;
let mockSelectedWaypoint: number | null | undefined;
/** What the viewport is told to draw a marker at. */
let mockTerrainPoint: [number, number, number] | null | undefined;
/** How bright the viewport is told to draw. */
let mockExposure: number | undefined;
/** Which VOBs the viewport is told not to draw — one byte per VOB, or null. */
let mockHiddenVobs: Uint8Array | null | undefined;
/** The steps the viewport is told to quantise a drag to. */
let mockSnapGrid: number | undefined;
let mockSnapAngle: number | undefined;
/** The viewport's imperative raycast — drop-to-ground and align-to-normal's
 *  only way to ask it anything. A `jest.fn` rather than a fixed answer, so
 *  each test says what the ray hits. */
const mockRaycastDown = jest.fn() as jest.Mock<
  { point: [number, number, number]; normal: [number, number, number] } | null,
  [[number, number, number]]
>;
/** The viewport's other imperative command: the camera jump the scene tree's
 *  double-click asks for. */
const mockFrameVob = jest.fn() as jest.Mock<void, [number]>;
/** A quarter turn about Y, row-major — asymmetric, so a transpose would show. */
const TURN: number[] = [0, 0, 1, 0, 1, 0, -1, 0, 0];
/** The pose every VOB in the fixture index has. */
const IDENTITY: ZenRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// The house pattern for react-window under jsdom, which has no layout — without
// it the scene tree renders no rows at all and the drag-and-drop test below has
// nothing to drag.
jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

jest.mock('../src/renderer/components/world/WorldViewport', () => {
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
    snapGrid: number;
    snapAngle: number;
    onSelectWaypoint: (waypoint: number | null) => void;
    onMoveWaypoint: (
      waypoint: number,
      from: [number, number, number],
      to: [number, number, number],
    ) => void;
  }, ref: React.Ref<{
    raycastDown: typeof mockRaycastDown; frameVob: typeof mockFrameVob;
  }>) => {
    mockAppliedOps = props.appliedOps;
    mockSelection = props.selection;
    mockGizmoMode = props.gizmoMode;
    mockSelectedWaypoint = props.selectedWaypoint;
    mockTerrainPoint = props.terrainPoint;
    mockExposure = props.exposure;
    mockHiddenVobs = props.hiddenVobs;
    mockSnapGrid = props.snapGrid;
    mockSnapAngle = props.snapAngle;
    // The imperative surface drop-to-ground, align-to-normal and the scene
    // tree's camera jump call directly — see `WorldViewportHandle`'s doc —
    // stood in by jest.fns so the shell side can be tested without a WebGL
    // raycast or a real camera.
    ReactActual.useImperativeHandle(ref, () => ({
      raycastDown: mockRaycastDown, frameVob: mockFrameVob,
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
});

/** Where a terrain click lands — ZenGin centimetres, deliberately not round. */
const TERRAIN: [number, number, number] = [1500.5, -220, 3300.25];

/** Waypoint 1's position in the payload below, and where the stub drags it. */
const WAYPOINT_WAS: [number, number, number] = [1000, 0, 1000];
const WAYPOINT_TO: [number, number, number] = [1400, 50, 900];

/**
 * A three-waypoint waynet, in the shape `getWaynet` emits it.
 *
 * Fresh per test, because the overlay draws a *view* over `positions` and an
 * applied move writes it in place — a shared fixture would carry one test's
 * move into the next.
 */
function waynetPayload(): WaynetPayload {
  return {
    count: 3,
    names: ['WP_START', 'WP_MIDDLE', 'WP_END'],
    positions: new Float32Array([0, 0, 0, ...WAYPOINT_WAS, 2000, 0, 2000]).buffer,
    directions: new Float32Array(9).buffer,
    waterDepths: new Int32Array(3).buffer,
    flags: new Uint32Array(3).buffer,
    edgeCount: 2,
    edges: new Uint32Array([0, 1, 1, 2]).buffer,
    danglingEdges: 0,
  };
}

/** The op a drag of waypoint 1 has to become. */
const WAYPOINT_MOVE: WorldOp = {
  op: 'MoveWaypoint', waypoint: 1, name: 'WP_MIDDLE', from: WAYPOINT_WAS, to: WAYPOINT_TO,
};

function vobIndex(
  positions: Array<[number, number, number]>,
  cls: string | readonly string[] = 'zCVob',
  // One parent per VOB, all roots unless a test wants a hierarchy — which the
  // paste does, because "into the selection's parent" is only distinguishable
  // from "into the roots" when the selection has one.
  parents: readonly number[] = positions.map(() => -1),
): VobIndex {
  const count = positions.length;
  const columns = new Float32Array(count * 3);
  positions.forEach((position, i) => columns.set(position, i * 3));
  const seen = new Map<number, number>();
  const childIndex = new Uint32Array(count);
  parents.forEach((parent, i) => {
    const slot = seen.get(parent) ?? 0;
    childIndex[i] = slot;
    seen.set(parent, slot + 1);
  });
  // Identity, not zeros: a zero matrix is not a rotation any world contains,
  // and a rotation op composed onto one produces a box collapsed to a point.
  const rotations = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) rotations.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);

  // One class name for the whole index, or one per VOB when a list is given.
  // The list is not a convenience: a single class means the selection can never
  // move between two *catalogued* classes, and that is exactly the move where
  // the class fields drawn and the props fetched can disagree.
  const perVob = typeof cls === 'string' ? positions.map(() => cls) : cls;
  const classes = [...new Set(perVob)];
  const classIndex = new Uint32Array(count);
  perVob.forEach((name, i) => { classIndex[i] = classes.indexOf(name); });

  return {
    count,
    parent: Int32Array.from(parents).buffer,
    childIndex: childIndex.buffer,
    positions: columns.buffer,
    rotations: rotations.buffer,
    flags: new Uint32Array(count).buffer,
    classes, classIndex: classIndex.buffer,
    names: ['BARREL'], nameIndex: new Uint32Array(count).buffer,
    visuals: ['BARREL.3DS'], visualIndex: new Uint32Array(count).buffer,
    visualTypes: ['MULTI_RESOLUTION_MESH'], visualTypeIndex: new Uint32Array(count).buffer,
  };
}

const SUMMARY: WorldSummary = {
  worldPath: 'C:/Gothic/NewWorld.zen',
  bbox: [0, 0, 0, 1, 1, 1],
  vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]),
  stats: { vobCount: 2, materials: 1, worldDrawGroups: 1, worldTriangles: 1 },
  timings: {},
};

/**
 * What the per-class read answers, in the shape the binding sends it: the whole
 * props object, base fields and all. A mutable module-level value rather than a
 * `mockResolvedValue`, because the read is re-issued on every applied batch and
 * an implementation set in one test would outlive it — `clearAllMocks` clears
 * calls, not implementations.
 */
/** The three `zCVob` fields every read carries, whatever the class — they are
 *  base fields and no VOB is without them. */
const BASE_PROPS = { presetName: 'FIRE_STAT', visualCamAlign: 1, bias: 2 };
let mockVobProps: Record<string, unknown> = { class: 'zCVob', ...BASE_PROPS };
const LIGHT_PROPS = {
  class: 'zCVobLight', range: 2000, color: [255, 220, 180, 255], ...BASE_PROPS,
};
const ITEM_PROPS = { class: 'oCItem', instance: 'ITMW_1H_SWORD_01', ...BASE_PROPS };

const MOVE: WorldOp = {
  op: 'MoveVob', vob: 1, path: '1', from: [10, 20, 30], to: [11, 22, 33],
};

/** One axis of the property grid's typed position — an input, so its value is
 *  not its text content. */
const coordinate = (axis: string) => screen.getByTestId(
  `world-prop-position-${axis}-input`,
) as HTMLInputElement;

const api = {
  getGothicInstall: jest.fn(async () => 'C:/Gothic II'),
  selectGothicInstall: jest.fn(),
  openWorldDialog: jest.fn(),
  openWorld: jest.fn(),
  getWorldMesh: jest.fn(),
  getWorldVisuals: jest.fn(),
  getWorldTexture: jest.fn(async () => null),
  listWorldAssets: jest.fn(async () => null),
  getWorldWaynet: jest.fn(),
  getVisualBounds: jest.fn(async (): Promise<number[] | null> => null),
  getVobProps: jest.fn(async (): Promise<Record<string, unknown>> => mockVobProps),
  refreshWorldIndex: jest.fn(),
  applyWorldOps: jest.fn(async () => undefined),
  undoWorldEdit: jest.fn(async (): Promise<WorldOp[] | null> => null),
  redoWorldEdit: jest.fn(async (): Promise<WorldOp[] | null> => null),
  saveWorldDialog: jest.fn(async (): Promise<string | null> => null),
  saveWorld: jest.fn(async () => undefined),
  closeWorld: jest.fn(),
};

/**
 * Open a world the way the user does — the viewport, and with it the gizmo, is
 * mounted only once the payloads have arrived. A fresh index per test: the ops
 * below mutate it in place.
 *
 * A drag is a translation of the *selection*, so a world with nothing selected
 * has nothing to drag: VOB 1 is selected here as the gizmo's own attachment
 * would do it.
 */
/** The last `openWorld` render, so a test can re-render the surface with a
 *  different prop — `hidden`, which nothing else here varies. */
let lastRender: ReturnType<typeof render>;

async function openWorld(cls?: string | readonly string[], parents?: readonly number[]) {
  const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]], cls, parents) };
  api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
  api.openWorld.mockResolvedValueOnce(summary as never);
  api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
  // One visual carrying VOB 1, with bounds — what a rotation refits the bbox
  // from. VOB 0 is deliberately not in it: a selection can hold a VOB with no
  // instance, and the op for it must carry no box rather than a guessed one.
  api.getWorldVisuals.mockResolvedValueOnce({
    visuals: [{
      name: 'BARREL.3DS',
      source: 'BARREL.MRM',
      count: 1,
      matrices: new Float32Array(12).buffer,
      vobIds: new Uint32Array([1]).buffer,
      groups: [],
      bounds: [-1, 0, -10, 1, 2, 10],
    }],
    stats: { vobsPlaced: 1 },
  } as never);

  lastRender = render(<WorldSurface />);
  fireEvent.click(screen.getByTestId('world-open'));
  await screen.findByTestId('stub-drag');
  // Awaited, not the bare synchronous `act`: selecting a VOB of a catalogued
  // class issues the per-class read, and its answer lands a microtask after the
  // selection — outside an `act` that has already returned.
  await act(async () => { useWorldStore.getState().selectVob(1); });
  return summary;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAppliedOps = undefined;
  mockTerrainPoint = undefined;
  mockExposure = undefined;
  mockHiddenVobs = undefined;
  mockSnapGrid = undefined;
  mockSnapAngle = undefined;
  mockVobProps = { class: 'zCVob', ...BASE_PROPS };
  mockRaycastDown.mockReset();
  mockFrameVob.mockReset();
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
  // The item index is seeded by two tests below; left standing it would refuse
  // an instance in every test after them.
  useProjectStore.getState().closeProject();
});

describe('a VOB dragged in the viewport', () => {
  it('becomes an op carrying where it came from, and reaches the main process', async () => {
    // `from` is read out of the index *before* the op is applied to it, which
    // is what makes the op invertible without a snapshot beside the history.
    const summary = await openWorld();

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([MOVE]));
    expect(createVobReader(summary.vobIndex).position(1)).toEqual([11, 22, 33]);
  });

  it('does not move the projection until the main process has taken the op', async () => {
    // The renderer's index is a projection of a world it does not own. Applying
    // the op here first would leave the two disagreeing whenever the op is
    // refused — and an op *is* refused, that is what the atomic batch is for.
    const summary = await openWorld();
    let take = (): void => undefined;
    api.applyWorldOps.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      take = () => resolve(undefined);
    }));

    fireEvent.click(screen.getByTestId('stub-drag'));
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(createVobReader(summary.vobIndex).position(1)).toEqual([10, 20, 30]);

    take();
    await waitFor(() => expect(createVobReader(summary.vobIndex).position(1)).toEqual([11, 22, 33]));
  });

  it('sends the VOB back where it was when the op is refused, and says so', async () => {
    // The viewport has already drawn the drag. Left alone, the VOB sits at a
    // position nothing in the world agrees with — including the property grid
    // right next to it.
    const summary = await openWorld();
    api.applyWorldOps.mockRejectedValueOnce(new Error('no vob at indexPath'));

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(mockAppliedOps).toEqual([{ ...MOVE, from: MOVE.to, to: MOVE.from }]));
    expect(createVobReader(summary.vobIndex).position(1)).toEqual([10, 20, 30]);
    expect(await screen.findByTestId('world-edit-error')).toHaveTextContent('no vob at indexPath');
  });

  it('shows the new position in the property grid', async () => {
    // The end of the loop, and the part React cannot see on its own: an op is
    // written *into* the index's buffers, so the summary is the same object and
    // nothing about it changes identity. Without something to notice the edit,
    // the grid goes on rendering the position the VOB used to have — beside a
    // viewport already drawing it somewhere else.
    await openWorld();
    // Straight through the store: the scene tree is virtualized and renders no
    // rows in jsdom, and which panel did the selecting is not what is under
    // test here.
    act(() => useWorldStore.getState().selectVob(1));
    expect(coordinate('x').value).toBe('10');
    expect(coordinate('y').value).toBe('20');
    expect(coordinate('z').value).toBe('30');

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(coordinate('x').value).toBe('11'));
    expect(coordinate('y').value).toBe('22');
    expect(coordinate('z').value).toBe('33');
  });

  it('hands the applied ops to the viewport, so the scene follows the index', async () => {
    await openWorld();

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(mockAppliedOps).toEqual([MOVE]));
  });
});

// Typed transform entry (level-editor.md §14.1 item 1.5). The point of these is
// the *path*: a coordinate typed into the grid must become the same `MoveVob`
// batch a drag becomes, through `translateVobs` and `commitOps`, so that undo,
// the atomic batch and the refusal-unwind are the ones already proven above.
describe('a coordinate typed into the property grid', () => {
  const type = (axis: string, value: string) => {
    const at = coordinate(axis);
    fireEvent.change(at, { target: { value } });
    fireEvent.blur(at);
  };

  it('becomes the same MoveVob a drag would, carrying where the VOB was', async () => {
    const summary = await openWorld();

    type('x', '110');

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
      op: 'MoveVob', vob: 1, path: '1', from: [10, 20, 30], to: [110, 20, 30],
    }]));
    expect(createVobReader(summary.vobIndex).position(1)).toEqual([110, 20, 30]);
  });

  it('moves the whole selection by the delta, exactly as the gizmo does', async () => {
    // The grid describes one VOB and says an edit here takes the selection with
    // it. A typed *absolute* applied to every VOB would stack them on one point.
    await openWorld();
    await act(async () => { useWorldStore.getState().toggleVob(0); });
    // VOB 0 is the primary now — the last one added, the one the grid
    // describes — and it sits at the origin.
    expect(coordinate('x').value).toBe('0');

    type('x', '100');

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([
      { op: 'MoveVob', vob: 1, path: '1', from: [10, 20, 30], to: [110, 20, 30] },
      { op: 'MoveVob', vob: 0, path: '0', from: [0, 0, 0], to: [100, 0, 0] },
    ]));
  });

  it('builds no op at all for a coordinate it cannot hold', async () => {
    // Refused before an op exists, which is the whole rule: a value the binding
    // would reject must not arrive at the bottom of a batch that has already
    // applied its other ops.
    await openWorld();

    type('x', 'over there');

    expect(api.applyWorldOps).not.toHaveBeenCalled();
    expect(coordinate('x').value).toBe('10');
  });

  it('shows the world\'s own coordinate again when the main process refuses it', async () => {
    // The live bug refactoring-targets.md §7 measured: a refused edit changes
    // nothing in the world, so no value-carrying key changes and the
    // uncontrolled input kept the typed 999 while the world holds 10. The fix
    // is `commitOps`' catch bumping the refusal generation the grid folds into
    // every field key — this drives the real catch, not a modelled prop.
    await openWorld();
    api.applyWorldOps.mockRejectedValueOnce(new Error('no vob at indexPath'));

    type('x', '999');

    expect(await screen.findByTestId('world-edit-error')).toHaveTextContent('no vob at indexPath');
    await waitFor(() => expect(coordinate('x').value).toBe('10'));
  });
});

// Typed rotation entry (level-editor.md §14.1 item 1.5, the rotation half).
// The path is the point again, and which path it is depends on the count: with
// one VOB selected a typed angle leaves as an **absolute** pose through
// `rotateVob`, because the angles on screen are the decomposed destination;
// with N it leaves as a **delta** through `rotateVobs`, the gizmo's own path,
// so the selection keeps the relative orientation it had (§16.4).
describe('an angle typed into the property grid', () => {
  const angle = (axis: string) => screen.getByTestId(
    `world-prop-rotation-${axis}-input`,
  ) as HTMLInputElement;

  it('becomes an absolute RotateVob carrying both poses and both boxes', async () => {
    const summary = await openWorld();
    expect(angle('yaw').value).toBe('0');

    fireEvent.change(angle('yaw'), { target: { value: '90' } });
    fireEvent.blur(angle('yaw'));

    const identity: ZenRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const to = eulerToZenRotation([90, 0, 0]) as ZenRotation;
    // VOB 1's visual bounds from `openWorld`'s payload — the box a rotation
    // refits, placed at the VOB's own position for each pose.
    const bounds: [number, number, number, number, number, number] = [-1, 0, -10, 1, 2, 10];
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
      op: 'RotateVob',
      vob: 1,
      path: '1',
      from: identity,
      to,
      fromBbox: placeBounds(bounds, identity, [10, 20, 30]),
      toBbox: placeBounds(bounds, to, [10, 20, 30]),
    }]));
    // And the projection followed, float32-rounded as the column stores it.
    const stored = createVobReader(summary.vobIndex).rotation(1)!;
    to.forEach((entry, at) => expect(stored[at]).toBeCloseTo(entry, 6));
  });

  it('is refused by the grid when the main process would be asked for nothing', async () => {
    // The board's trap: the read normalizes, so for the 30.2 % of retail VOBs
    // whose stored matrix is non-orthonormal, committing an angle the user did
    // not change would re-orthonormalize the matrix and rewrite bytes nobody
    // asked for. An unchanged displayed angle therefore never becomes an op.
    await openWorld();

    fireEvent.change(angle('yaw'), { target: { value: '0' } });
    fireEvent.blur(angle('yaw'));

    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });
  it('turns a whole selection by the delta, in one batch', async () => {
    // The multi-selection half, and the reason it is a batch: `WorldService`
    // records one call as one undo entry, so N VOBs turned together must arrive
    // as one list — exactly as a multi-select gizmo drag does. The grid types
    // into the anchor's angles and the shell sends `rotateVobs`, so there is no
    // second op-building path to keep in step.
    const summary = await openWorld();
    act(() => useWorldStore.getState().toggleVob(0));
    // The anchor is the last VOB of the selection — the one every row of the
    // grid describes — and it is unturned, so 90 typed into its yaw is a
    // quarter turn for everything selected.
    expect(angle('yaw').value).toBe('0');

    fireEvent.change(angle('yaw'), { target: { value: '90' } });
    fireEvent.blur(angle('yaw'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const ops = api.applyWorldOps.mock.calls[0][0] as WorldOp[];
    expect(ops.map((op) => [op.op, (op as { vob: number }).vob]))
      .toEqual([['RotateVob', 1], ['RotateVob', 0]]);
    // Each op carries its own VOB's pose as `from` — what makes the batch
    // invertible — and `to` is that pose with the delta composed on the left.
    const delta = eulerDeltaRotation([0, 0, 0], [90, 0, 0]);
    for (const op of ops as Array<{ from: ZenRotation; to: ZenRotation }>) {
      expect(op.from).toEqual(IDENTITY);
      delta.forEach((entry, at) => expect(op.to[at]).toBeCloseTo(entry, 6));
    }
    // And the projection followed for both, not just the anchor.
    const reader = createVobReader(summary.vobIndex);
    for (const vob of [0, 1]) {
      delta.forEach((entry, at) => expect(reader.rotation(vob)![at]).toBeCloseTo(entry, 6));
    }
  });
});

describe('a multi-select drag', () => {
  it('is one batch — one call, one op per VOB, each from where that VOB was', async () => {
    // The whole point of multi-select: `WorldService` records a batch as one
    // undo entry and `commitOps` applies it atomically, so N VOBs moved
    // together must arrive as one list. N calls would be N undo entries, and
    // Ctrl+Z would put them back one at a time.
    const summary = await openWorld();
    act(() => useWorldStore.getState().toggleVob(0));

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    expect(api.applyWorldOps).toHaveBeenCalledWith([
      // In selection order, and each op carries its own VOB's origin — the
      // selection keeps the spacing it had rather than collapsing onto a point.
      { op: 'MoveVob', vob: 1, path: '1', from: [10, 20, 30], to: [11, 22, 33] },
      { op: 'MoveVob', vob: 0, path: '0', from: [0, 0, 0], to: [1, 2, 3] },
    ]);
    const reader = createVobReader(summary.vobIndex);
    expect(reader.position(0)).toEqual([1, 2, 3]);
    expect(reader.position(1)).toEqual([11, 22, 33]);
  });

  it('sends the whole selection back when the batch is refused', async () => {
    // A refused batch moved nothing — `commitOps` unwound it — so every VOB the
    // viewport has already drawn at its dragged position has to be put back,
    // not just the one the gizmo was on.
    const summary = await openWorld();
    act(() => useWorldStore.getState().toggleVob(0));
    api.applyWorldOps.mockRejectedValueOnce(new Error('no vob at indexPath'));

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(mockAppliedOps).toHaveLength(2));
    expect(mockAppliedOps).toEqual([
      { op: 'MoveVob', vob: 1, path: '1', from: [11, 22, 33], to: [10, 20, 30] },
      { op: 'MoveVob', vob: 0, path: '0', from: [1, 2, 3], to: [0, 0, 0] },
    ]);
    const reader = createVobReader(summary.vobIndex);
    expect(reader.position(0)).toEqual([0, 0, 0]);
    expect(reader.position(1)).toEqual([10, 20, 30]);
  });

  it('hands the viewport the selection, so the gizmo drives all of it', async () => {
    await openWorld();

    act(() => useWorldStore.getState().toggleVob(0));

    await waitFor(() => expect(mockSelection).toEqual([1, 0]));
  });

  it('does nothing at all with nothing selected', async () => {
    // The gizmo is detached then, but the drag hook is reachable from the
    // driver script and an empty batch is an undo entry that undoes nothing.
    await openWorld();
    act(() => useWorldStore.getState().selectVob(null));

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(mockSelection).toEqual([]));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });
});

describe('a turn of the gizmo', () => {
  it('becomes a RotateVob carrying both matrices and both boxes', async () => {
    // The box is half of what a rotation writes: the engine culls by it, and an
    // axis-aligned box does not rotate into an axis-aligned box. It is refitted
    // from the visual's own bounds — measured, that is what a retail world
    // stores — and both poses' boxes travel in the op so undo restores the one
    // it started from.
    const summary = await openWorld();

    fireEvent.click(screen.getByTestId('stub-turn'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    expect(api.applyWorldOps).toHaveBeenCalledWith([{
      op: 'RotateVob',
      vob: 1,
      path: '1',
      from: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      to: TURN,
      // VOB 1 sits at [10, 20, 30]; its visual spans x -1..1 and z -10..10, so
      // a quarter turn about Y swaps those extents.
      fromBbox: [9, 20, 20, 11, 22, 40],
      toBbox: [0, 20, 29, 20, 22, 31],
    }]);
    expect(createVobReader(summary.vobIndex).rotation(1)).toEqual(TURN);
    // A turn is not a move.
    expect(createVobReader(summary.vobIndex).position(1)).toEqual([10, 20, 30]);
  });

  it('carries no box for a selected VOB that is not drawn', async () => {
    // VOB 0 has no instance in the payload, so there are no bounds to refit
    // from. A guessed box bounds nothing; the stale one bounded the visual in
    // some pose.
    await openWorld();
    act(() => useWorldStore.getState().selectVob(0));

    fireEvent.click(screen.getByTestId('stub-turn'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [[ops]] = api.applyWorldOps.mock.calls as unknown as [[WorldOp[]]];
    expect(ops[0]).toMatchObject({ op: 'RotateVob', vob: 0, fromBbox: null, toBbox: null });
  });

  it('puts the whole op back, boxes included, when it is refused', async () => {
    await openWorld();
    api.applyWorldOps.mockRejectedValueOnce(new Error('no vob at indexPath'));

    fireEvent.click(screen.getByTestId('stub-turn'));

    await waitFor(() => expect(mockAppliedOps).not.toBeNull());
    expect(mockAppliedOps).toEqual([{
      op: 'RotateVob',
      vob: 1,
      path: '1',
      from: TURN,
      to: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      // Swapped with the matrices. Half an inverse would send the VOB back and
      // leave it culled by a box fitted to the pose it no longer holds.
      fromBbox: [0, 20, 29, 20, 22, 31],
      toBbox: [9, 20, 20, 11, 22, 40],
    }]);
  });

  it('switches the gizmo on W and E, and on the toggle', async () => {
    await openWorld();
    expect(mockGizmoMode).toBe('translate');

    fireEvent.keyDown(window, { key: 'e' });
    await waitFor(() => expect(mockGizmoMode).toBe('rotate'));

    fireEvent.keyDown(window, { key: 'w' });
    await waitFor(() => expect(mockGizmoMode).toBe('translate'));

    fireEvent.click(screen.getByTestId('world-gizmo-rotate'));
    await waitFor(() => expect(mockGizmoMode).toBe('rotate'));
  });

  it('leaves the gizmo alone when the letter was typed into a field', async () => {
    // Bare letters, on a *window* listener: the app is full of text fields and
    // an 'e' typed into one must not silently change what the gizmo does.
    await openWorld();
    const field = document.createElement('input');
    document.body.appendChild(field);

    fireEvent.keyDown(field, { key: 'e' });

    expect(mockGizmoMode).toBe('translate');
    document.body.removeChild(field);
  });
});

describe('the viewport brightness', () => {
  it('lifts the viewport brightness without touching the world', async () => {
    // "Interiors are too dark" (2026-08-27): ZenGin's lighting is baked into
    // the vertex colours, so there is no light to add and the answer is an
    // exposure lift on the picture. It reaches the viewport and nothing else —
    // no op, so no edit for the main process to take and nothing to save.
    await openWorld();
    expect(mockExposure).toBe(1);

    fireEvent.change(screen.getByLabelText('Brightness'), { target: { value: '2.5' } });

    await waitFor(() => expect(mockExposure).toBe(2.5));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
    expect(mockAppliedOps ?? null).toBeNull();
  });

});

describe('per-class visibility', () => {
  /** Toggle one class in the show/hide list, the way Spacer's VOB-type
   *  checkboxes are toggled. */
  const toggleClass = async (name: string) => {
    fireEvent.mouseDown(within(screen.getByTestId('world-hidden-classes')).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  };

  it('hides a whole VOB class in the viewport, and nothing else', async () => {
    // Spacer's VOB-type show/hide (§16.16), answered by the *filter's*
    // predicate: `matchVobs` over the interned class dictionary, one byte per
    // VOB. VOB 0 is the light; VOB 1, the selected one, is a plain zCVob.
    await openWorld(['zCVobLight', 'zCVob']);
    // Nothing hidden is null, not an array of zeros: the unfiltered world must
    // not pay for a predicate nobody asked for.
    expect(mockHiddenVobs ?? null).toBeNull();

    await toggleClass('zCVobLight');

    await waitFor(() => expect([...(mockHiddenVobs ?? [])]).toEqual([1, 0]));
    // A view setting: no op, nothing dirtied, nothing saved.
    expect(api.applyWorldOps).not.toHaveBeenCalled();
    expect(mockAppliedOps ?? null).toBeNull();
  });

  it('shows the class again when it is toggled off', async () => {
    await openWorld(['zCVobLight', 'zCVob']);

    await toggleClass('zCVobLight');
    await waitFor(() => expect([...(mockHiddenVobs ?? [])]).toEqual([1, 0]));
    await toggleClass('zCVobLight');

    await waitFor(() => expect(mockHiddenVobs ?? null).toBeNull());
  });
});

describe('the snap step', () => {
  /** The one control, which means whichever step the gizmo mode is about. */
  const chooseStep = async (label: string) => {
    fireEvent.mouseDown(within(screen.getByTestId('world-snap')).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: label }));
  };

  it('is free-form until a step is chosen, and then reaches the gizmo in centimetres', async () => {
    // Free by default, so the gizmo behaves as it always has — and so
    // `verify-world-edit.js`, which drags to exact coordinates, still lands on
    // them.
    await openWorld();
    expect(mockSnapGrid).toBe(0);

    await chooseStep('1 m');

    // ZenGin centimetres, which is what every position in this app is in.
    await waitFor(() => expect(mockSnapGrid).toBe(100));
    // A view setting like the brightness: it changes how an edit is made and is
    // not itself an edit.
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('offers angles in the turn mode and keeps both steps', async () => {
    await openWorld();
    await chooseStep('50 cm');
    await waitFor(() => expect(mockSnapGrid).toBe(50));

    fireEvent.click(screen.getByTestId('world-gizmo-rotate'));
    // The control follows the mode: a distance is meaningless for a turn, so
    // what it offers now is angles — and the angle step starts free.
    await waitFor(() => expect(mockGizmoMode).toBe('rotate'));
    expect(mockSnapAngle).toBe(0);

    await chooseStep('45°');
    // Degrees on the bar, radians on the wire — the gizmo turns in radians.
    await waitFor(() => expect(mockSnapAngle).toBeCloseTo(Math.PI / 4, 10));

    // And the move step survived the detour: switching back must not have
    // reset the step the other mode was set to.
    fireEvent.click(screen.getByTestId('world-gizmo-translate'));
    await waitFor(() => expect(mockGizmoMode).toBe('translate'));
    expect(mockSnapGrid).toBe(50);
    expect(mockSnapAngle).toBeCloseTo(Math.PI / 4, 10);
  });
});

describe('saving the world', () => {
  const openSaveDialog = async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-save'));
    await screen.findByTestId('world-save-confirm');
  };

  it('warns before it asks for a file, not after it has written one', async () => {
    // Both warnings are facts about ZenGin rather than about this editor, and
    // both are about whether to save at all: the lighting a world was compiled
    // with is not re-baked by an edit, and a savegame carries its own copy of
    // the VOB tree.
    await openSaveDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/lighting/i);
    expect(dialog).toHaveTextContent(/savegame/i);
    expect(api.saveWorldDialog).not.toHaveBeenCalled();
  });

  it('writes nothing when the warning is dismissed', async () => {
    await openSaveDialog();

    fireEvent.click(screen.getByTestId('world-save-cancel'));

    await waitFor(() => expect(screen.queryByTestId('world-save-confirm')).not.toBeInTheDocument());
    expect(api.saveWorldDialog).not.toHaveBeenCalled();
    expect(api.saveWorld).not.toHaveBeenCalled();
  });

  it('suggests a name beside the original rather than the original', async () => {
    // The worlds this app opens are retail game files. Overwriting one is
    // reachable — the OS dialog asks — but it is never the pre-filled answer.
    await openSaveDialog();
    api.saveWorldDialog.mockResolvedValueOnce(null as never);

    fireEvent.click(screen.getByTestId('world-save-confirm'));

    await waitFor(() => expect(api.saveWorldDialog)
      .toHaveBeenCalledWith('C:/Gothic/NewWorld.edited.zen'));
    expect(api.saveWorld).not.toHaveBeenCalled();
  });

  it('writes to the chosen file and says where it went', async () => {
    await openSaveDialog();
    api.saveWorldDialog.mockResolvedValueOnce('C:/out/NewWorld.zen' as never);

    fireEvent.click(screen.getByTestId('world-save-confirm'));

    await waitFor(() => expect(api.saveWorld).toHaveBeenCalledWith('C:/out/NewWorld.zen'));
    expect(await screen.findByTestId('world-saved')).toHaveTextContent('C:/out/NewWorld.zen');
  });

  it('shows the binding\'s refusal without tearing the world down', async () => {
    // A non-BinSafe world is the case this is for, and the sentence the binding
    // writes is the only one the user can act on.
    await openSaveDialog();
    api.saveWorldDialog.mockResolvedValueOnce('C:/out/OldCamp.zen' as never);
    api.saveWorld.mockRejectedValueOnce(
      new Error("refusing to save a world loaded from a 'ascii' archive"),
    );

    fireEvent.click(screen.getByTestId('world-save-confirm'));

    expect(await screen.findByTestId('world-save-error')).toHaveTextContent(/binsafe|ascii/i);
    expect(screen.getByTestId('world-viewport-stub')).toBeInTheDocument();
  });
});

describe('deleting a VOB', () => {
  // The op §15 unblocked, and the half of it that is *not* the op: a delete has
  // no inverse, so the history clears rather than recording it — and the one
  // requirement §15 put in place of invertibility is that the user knows that
  // before it lands, because ours undoes everything else.

  /** Select one VOB and ask to delete it, without confirming. */
  async function askToDelete(vob: number) {
    await act(async () => { useWorldStore.getState().selectVob(vob); });
    fireEvent.click(await screen.findByTestId('world-delete-vob'));
  }

  it('is a DeleteVob for the selected VOB, once the warning is confirmed', async () => {
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    await askToDelete(1);
    fireEvent.click(screen.getByTestId('world-delete-confirm'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    // Alone in its batch, because it renumbers — `commitOps` enforces that, and
    // there is nothing here for it to share a batch with anyway.
    expect(ops).toEqual([{ op: 'DeleteVob', vob: 1, path: '1' }]);
  });

  it('warns that the edit cannot be undone and that the history goes with it', async () => {
    // Not decoration and not a generic "are you sure": every other edit in this
    // surface is undoable, so a delete that quietly made the previous twenty
    // unundoable is the surprise. Spacer has no undo at all, which is why the
    // op ships — not why the warning is optional.
    await openWorld();

    await askToDelete(1);

    const warning = screen.getByTestId('world-delete-warning');
    expect(warning).toHaveTextContent(/cannot be undone/i);
    expect(warning).toHaveTextContent(/undo history|undo stack|earlier edits/i);
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('sends nothing when the warning is dismissed', async () => {
    await openWorld();

    await askToDelete(1);
    fireEvent.click(screen.getByTestId('world-delete-cancel'));

    expect(api.applyWorldOps).not.toHaveBeenCalled();
    // Removed rather than merely hidden — the dialog closes on its own animation.
    await waitFor(() => expect(screen.queryByTestId('world-delete-warning')).not.toBeInTheDocument());
  });

  it('is offered for exactly one VOB, never for a selection of them', async () => {
    // Every other edit here applies to the whole selection — one gizmo drags
    // all of them. A delete cannot: it renumbers, so each one would need its own
    // batch against a re-read index, and a button that deleted only the primary
    // of five would be a surprise of exactly the kind this dialog exists to
    // prevent.
    await openWorld();

    act(() => useWorldStore.getState().selectVob(null));
    expect(screen.getByTestId('world-delete-vob')).toBeDisabled();

    // Awaited: every selection issues the per-VOB props read, and its answer
    // lands a microtask later — outside an `act` that has already returned.
    await act(async () => { useWorldStore.getState().selectVob(0); });
    expect(screen.getByTestId('world-delete-vob')).toBeEnabled();

    await act(async () => { useWorldStore.getState().toggleVob(1); });
    expect(screen.getByTestId('world-delete-vob')).toBeDisabled();
  });

  it('re-reads the index and drops the selection, because it renumbers', async () => {
    // The columnar projection cannot lose a row, and every VOB after the deleted
    // one has changed its flat index — so a selection kept would name a VOB
    // nobody picked, and the property grid would describe it.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(
      { ...summary, vobIndex: vobIndex([[0, 0, 0]]) } as never,
    );
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    await askToDelete(1);
    fireEvent.click(screen.getByTestId('world-delete-confirm'));

    await waitFor(() => expect(api.refreshWorldIndex).toHaveBeenCalled());
    await waitFor(() => expect(useWorldStore.getState().selection).toEqual([]));
    expect(useWorldStore.getState().summary!.vobIndex.count).toBe(1);
  });

  it('says so and changes nothing when the main process refuses it', async () => {
    const summary = await openWorld();
    api.applyWorldOps.mockRejectedValueOnce(new Error('no vob at indexPath'));

    await askToDelete(1);
    fireEvent.click(screen.getByTestId('world-delete-confirm'));

    expect(await screen.findByTestId('world-edit-error')).toHaveTextContent(/no vob at indexPath/);
    // Not refreshed: nothing was deleted, so the index the panels read is still
    // the world's.
    expect(api.refreshWorldIndex).not.toHaveBeenCalled();
    expect(summary.vobIndex.count).toBe(2);
  });
});

describe('duplicating a VOB', () => {
  // Spacer's most-used verb after move (level-editor.md §16.14, D1), and it
  // adds no op: the spec is read out of the row and committed as an ordinary
  // `AddVob`, so undo comes free.

  it('is an AddVob carrying the row it was copied from, appended beside it', async () => {
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    await act(async () => { useWorldStore.getState().selectVob(1); });
    fireEvent.click(await screen.findByTestId('world-duplicate-vob'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops).toEqual([{
      op: 'AddVob',
      // VOB 1 is a root, so the copy is appended to the roots: enumerated last,
      // and in the slot after the last one. Which is also why it renumbers
      // nothing and the selection survives it.
      vob: 2,
      path: '2',
      parentPath: null,
      from: null,
      to: {
        name: 'BARREL',
        visual: 'BARREL.3DS',
        position: [10, 20, 30],
        rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        // Fitted from the visual's own bounds, which is the same box VOB 1
        // has — the index carries no bbox column to copy, and the binding's
        // default is a 10 cm cube that would cull a barrel.
        bbox: placeBounds([-1, 0, -10, 1, 2, 10], IDENTITY, [10, 20, 30]),
        showVisual: false,
        vobStatic: false,
        ambient: false,
        cdStatic: false,
        cdDynamic: false,
      },
    }]);
  });

  it('carries the class, so a duplicated light is a light', async () => {
    // D2's class half (level-editor.md §16.14). The class reaches the op
    // through the same spec every other field does — nothing new is fetched —
    // and it is the difference between a copy of a light and a `zCVob` wearing
    // its name, on which every `SetVobClassProp` would then be refused.
    mockVobProps = LIGHT_PROPS;
    const summary = await openWorld(['zCVob', 'zCVobLight']);
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.click(await screen.findByTestId('world-duplicate-vob'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops[0]).toMatchObject({ op: 'AddVob', to: { class: 'zCVobLight' } });
  });

  it('drops a class the binding cannot construct, rather than refusing the copy', async () => {
    // A `zCVobLensFlare` duplicates as it always did — name, visual, pose, no
    // class — because naming a class `insertVob` has no construction for is
    // refused by `assertApplyOpsRequest`, and a refused op is worse than a lossy
    // copy. This was `zCVobStartpoint` until I5 made the markers authorable, and
    // a lens flare is its closest remaining analogue: neither authorable nor
    // catalogued, so the grid draws no class field for it either.
    const summary = await openWorld(['zCVob', 'zCVobLensFlare']);
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.click(await screen.findByTestId('world-duplicate-vob'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect((ops[0] as { to: Record<string, unknown> }).to).not.toHaveProperty('class');
  });

  it('carries no box for a VOB with no visual instance', async () => {
    // VOB 0 is not in the visuals payload — a decal, a `.pfx`. There is nothing
    // to fit, so the copy takes the binding's default rather than VOB 1's box.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    act(() => useWorldStore.getState().selectVob(0));
    fireEvent.click(await screen.findByTestId('world-duplicate-vob'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops[0]).toMatchObject({ op: 'AddVob', vob: 2, path: '2' });
    expect((ops[0] as { to: Record<string, unknown> }).to).not.toHaveProperty('bbox');
  });

  it('is offered for a selection of any size, unlike the delete beside it', async () => {
    // D4 (level-editor.md §16.14). A delete stays at one because it renumbers
    // paths and each would need its own batch; an append moves no path, so a
    // selection duplicates whole — and the button that used to copy only the
    // primary of five is what that removes.
    await openWorld();

    act(() => useWorldStore.getState().selectVob(null));
    expect(await screen.findByTestId('world-duplicate-vob')).toBeDisabled();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    expect(screen.getByTestId('world-duplicate-vob')).toBeEnabled();
    await act(async () => { useWorldStore.getState().toggleVob(0); });
    expect(screen.getByTestId('world-duplicate-vob')).toBeEnabled();
    // And it says how many, because the singular label on a five-VOB selection
    // would be describing an edit the button no longer makes.
    expect(screen.getByTestId('world-duplicate-vob')).toHaveTextContent('Duplicate 2 VOBs');
    expect(screen.getByTestId('world-delete-vob')).toBeDisabled();
  });

  it('brings the whole subtree, at paths the batch computes forward', async () => {
    // D5 (level-editor.md §16.14). VOB 1 is a child of VOB 0 here, so
    // duplicating VOB 0 is two adds: the root's copy beside it, and the child's
    // copy under *that* — a path that cannot be resolved against the world as
    // it is, because the parent it names is the op before it.
    const summary = await openWorld(undefined, [-1, 0]);
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    act(() => useWorldStore.getState().selectVob(0));
    fireEvent.click(await screen.findByTestId('world-duplicate-vob'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops.map((op) => [
      op.op, (op as { path: string }).path, (op as { parentPath: string | null }).parentPath,
    ])).toEqual([['AddVob', '1', null], ['AddVob', '1/0', '1']]);
    // The child's copy is the child's own row, fitted the child's own box.
    expect((ops[1] as { to: Record<string, unknown> }).to).toMatchObject({
      name: 'BARREL',
      position: [10, 20, 30],
      bbox: placeBounds([-1, 0, -10, 1, 2, 10], IDENTITY, [10, 20, 30]),
    });
  });

  it('copies a selected child once when its parent is selected too', async () => {
    // The selection is pruned to its top-level VOBs. Without it the child would
    // get a copy inside its parent's copy *and* another beside itself.
    const summary = await openWorld(undefined, [-1, 0]);
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    act(() => useWorldStore.getState().selectVob(0));
    act(() => useWorldStore.getState().toggleVob(1));
    fireEvent.click(await screen.findByTestId('world-duplicate-vob'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops.map((op) => (op as { path: string }).path)).toEqual(['1', '1/0']);
  });

  it('copies a whole selection in one batch, so it is one undo', async () => {
    // The whole of D4: two ops, one `applyWorldOps` call, therefore one entry
    // in the main process's history. Both VOBs are roots here, so the copies
    // take the two slots after the last one — consecutively, which is the
    // correction `duplicateVobs` makes and a plain `map` would not.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    act(() => useWorldStore.getState().selectVob(0));
    act(() => useWorldStore.getState().toggleVob(1));
    fireEvent.click(await screen.findByTestId('world-duplicate-vob'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops).toHaveLength(2);
    expect(ops.map((op) => [op.op, (op as { path: string }).path])).toEqual([
      ['AddVob', '2'], ['AddVob', '3'],
    ]);
    // Each copy carries its *own* bounds, not the selection's first: VOB 0 has
    // no visual instance and VOB 1 is the barrel.
    const specs = ops.map((op) => (op as { to: Record<string, unknown> }).to);
    expect(specs[0]).not.toHaveProperty('bbox');
    expect(specs[1]).toMatchObject({
      name: 'BARREL',
      bbox: placeBounds([-1, 0, -10, 1, 2, 10], IDENTITY, [10, 20, 30]),
    });
  });
});

describe('copying and pasting a VOB', () => {
  // D3 (level-editor.md §16.14): duplicate taken apart into two verbs. The
  // clipboard is in-process and holds *subtrees* — what the rows said when Ctrl+C
  // was pressed — so where a copy lands is chosen at the paste, and the paste
  // is still a batch of pure adds and still one undo entry.
  const copy = () => fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
  const paste = () => fireEvent.keyDown(window, { key: 'v', ctrlKey: true });

  /** A paste re-reads the index, exactly as a duplicate does. */
  function expectRefresh(summary: WorldSummary) {
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
  }

  it('pastes into the parent of the selection, so the copy is its sibling', async () => {
    // VOB 1 is a child of VOB 0 here — the one fixture in this file that is not
    // flat, because "the selection's parent" and "the roots" are the same
    // answer in a flat world and this is the assertion that tells them apart.
    const summary = await openWorld(undefined, [-1, 0]);
    expectRefresh(summary);

    copy();
    paste();

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops).toEqual([{
      op: 'AddVob',
      // VOB 0's second child: appended, so it renumbers no path and the batch
      // is legal for the same reason a duplicate's is.
      vob: 2,
      path: '0/1',
      parentPath: '0',
      from: null,
      to: {
        name: 'BARREL',
        visual: 'BARREL.3DS',
        position: [10, 20, 30],
        rotation: IDENTITY,
        bbox: placeBounds([-1, 0, -10, 1, 2, 10], IDENTITY, [10, 20, 30]),
        showVisual: false,
        vobStatic: false,
        ambient: false,
        cdStatic: false,
        cdDynamic: false,
      },
    }]);
  });

  it('pastes a subtree under the copy of its own root', async () => {
    // The clipboard holds subtrees since D5, so a paste puts the root beside
    // the selection and the descendants under the root's copy — not all of
    // them into the one list.
    const summary = await openWorld(undefined, [-1, 0]);
    expectRefresh(summary);

    act(() => useWorldStore.getState().selectVob(0));
    copy();
    paste();

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops.map((op) => [
      (op as { path: string }).path, (op as { parentPath: string | null }).parentPath,
    ])).toEqual([['1', null], ['1/0', '1']]);
  });

  it('pastes what was copied, not what is selected now', async () => {
    // The whole difference from duplicate. The clipboard is a value taken at
    // the copy: moving the selection afterwards moves where the paste lands,
    // never what it pastes.
    const summary = await openWorld();
    expectRefresh(summary);

    copy();
    act(() => useWorldStore.getState().selectVob(0));
    paste();

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    // VOB 0 is a root, so the copy goes to the roots — and it is still VOB 1's
    // barrel, not VOB 0's nameless row.
    expect(ops[0]).toMatchObject({ op: 'AddVob', path: '2', parentPath: null });
    expect((ops[0] as { to: Record<string, unknown> }).to).toMatchObject({ name: 'BARREL' });
  });

  it('copies a whole selection and pastes it as one batch', async () => {
    const summary = await openWorld();
    expectRefresh(summary);

    act(() => useWorldStore.getState().selectVob(0));
    act(() => useWorldStore.getState().toggleVob(1));
    copy();
    // Nothing selected at the paste: the roots are where a copy goes when there
    // is no selection to take a parent from.
    act(() => useWorldStore.getState().selectVob(null));
    paste();

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops.map((op) => [op.op, (op as { path: string }).path])).toEqual([
      ['AddVob', '2'], ['AddVob', '3'],
    ]);
  });

  it('pastes the same clipboard again, so a copy is not consumed', async () => {
    const summary = await openWorld();
    expectRefresh(summary);
    expectRefresh(summary);

    copy();
    paste();
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    paste();
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(2));
  });

  it('leaves the clipboard standing when Ctrl+C is pressed with no selection', async () => {
    // A copy of nothing is not a copy: with no VOB selected the keystroke is
    // the browser's, so the surface neither empties its clipboard nor swallows
    // a copy of the text on screen.
    const summary = await openWorld();
    expectRefresh(summary);

    copy();
    act(() => useWorldStore.getState().selectVob(null));
    copy();
    act(() => useWorldStore.getState().selectVob(0));
    paste();

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect((ops[0] as { to: Record<string, unknown> }).to).toMatchObject({ name: 'BARREL' });
  });

  it('does nothing at all when nothing has been copied', async () => {
    await openWorld();

    paste();

    await waitFor(() => expect(mockSelection).toEqual([1]));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('leaves Ctrl+C alone in a text field, where the browser owns it', async () => {
    // The property grid is full of inputs and this is a *window* listener, so
    // the guard is the same one the bare W and E shortcuts carry: a copy typed
    // into a coordinate is the user copying a number.
    await openWorld();

    fireEvent.keyDown(coordinate('x'), { key: 'c', ctrlKey: true });
    paste();

    await waitFor(() => expect(mockSelection).toEqual([1]));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });
});

describe('placing a VOB', () => {
  /** Pick terrain, open the dialog, fill it in and confirm. */
  async function place(visual: string, name = '') {
    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    // Nothing is selected after a terrain hit, so the placement bar is what the
    // surface shows instead of a property grid.
    act(() => useWorldStore.getState().selectVob(null));
    fireEvent.click(await screen.findByTestId('world-place-vob'));

    fireEvent.change(screen.getByTestId('world-place-visual'), { target: { value: visual } });
    if (name !== '') {
      fireEvent.change(screen.getByTestId('world-place-name'), { target: { value: name } });
    }
    fireEvent.click(screen.getByTestId('world-place-confirm'));
  }

  it('becomes an AddVob at the point that was clicked, appended as a root', async () => {
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    await place('NW_CRATE.3DS', 'PLACED_01');

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      op: 'AddVob',
      // Two VOBs in the fixture, both roots: the new one is enumerated last and
      // takes the index one past the end, in the slot after the last root.
      vob: 2,
      path: '2',
      from: null,
      to: { name: 'PLACED_01', visual: 'NW_CRATE.3DS', position: TERRAIN },
    });
  });

  it('becomes an AddVob under the selected VOB when the dialog is told to', async () => {
    // The parent is the selected VOB rather than anything chosen in the dialog:
    // a terrain point survives a click in the scene tree — only a viewport pick
    // replaces it — so "click the ground, then click the parent" is the gesture,
    // and the dialog only has to say which of the two it will use.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    act(() => useWorldStore.getState().selectVob(0));
    fireEvent.click(await screen.findByTestId('world-place-vob'));
    fireEvent.click(screen.getByTestId('world-place-parent'));
    fireEvent.change(screen.getByTestId('world-place-visual'), { target: { value: 'NW_CRATE.3DS' } });
    fireEvent.click(screen.getByTestId('world-place-confirm'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      op: 'AddVob',
      // VOB 0 has no children, so the new one is its first — and it is
      // enumerated as soon as VOB 0's subtree ends, which is index 1.
      vob: 1,
      path: '0/0',
      parentPath: '0',
      to: { visual: 'NW_CRATE.3DS', position: TERRAIN },
    });
  });

  it('offers no parent when nothing is selected, and places a root', async () => {
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    act(() => useWorldStore.getState().selectVob(null));
    fireEvent.click(await screen.findByTestId('world-place-vob'));

    // Asserted while the dialog is open, or it is absent for the trivial reason.
    expect(screen.getByTestId('world-place-visual')).toBeInTheDocument();
    expect(screen.queryByTestId('world-place-parent')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('world-place-visual'), { target: { value: 'NW_CRATE.3DS' } });
    fireEvent.click(screen.getByTestId('world-place-confirm'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops[0]).toMatchObject({ op: 'AddVob', parentPath: null, path: '2' });
  });

  it('places an oCItem, which carries an instance instead of a visual', async () => {
    // The class is the object's C++ type (level-editor.md §16.15, I1), so it is
    // chosen here or never: nothing can turn the `zCVob` this used to always
    // author into an item afterwards. An item has no visual in the file at all —
    // the engine derives it from the script instance — so the dialog offers the
    // instance in the visual's place rather than beside it.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    act(() => useWorldStore.getState().selectVob(null));
    fireEvent.click(await screen.findByTestId('world-place-vob'));

    fireEvent.change(screen.getByTestId('world-place-class'), { target: { value: 'oCItem' } });
    expect(screen.queryByTestId('world-place-visual')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('world-place-instance'), { target: { value: 'ITFO_APPLE' } });
    fireEvent.click(screen.getByTestId('world-place-confirm'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      op: 'AddVob',
      path: '2',
      parentPath: null,
      to: { class: 'oCItem', instance: 'ITFO_APPLE', position: TERRAIN },
    });
    expect((ops[0] as { to: Record<string, unknown> }).to).not.toHaveProperty('visual');
  });

  it('places every class but the item with no instance and no visual', async () => {
    // I2's classes, I3's trigger family and I4's movable objects
    // (level-editor.md §16.15). None
    // carries a visual — a light *is* its own light, a sound its own sound and
    // a trigger a volume — and none takes an instance, so the dialog offers the
    // visual field and nothing else, and what makes the VOB the thing it is
    // comes from the binding's construction and then from the property grid.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValue(summary as never);
    api.getWorldVisuals.mockResolvedValue({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    for (const className of [
      'zCVobLight', 'zCVobSound', 'zCVobSoundDaytime',
      'zCTrigger', 'zCTriggerList', 'oCTriggerScript', 'oCTriggerChangeLevel',
      'zCMover', 'zCCodeMaster', 'zCMessageFilter',
      'oCMobInter', 'oCMobBed', 'oCMobLadder', 'oCMobSwitch', 'oCMobWheel',
      'oCMobDoor', 'oCMobContainer', 'oCTouchDamage',
    ]) {
      api.applyWorldOps.mockClear();
      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      fireEvent.click(await screen.findByTestId('world-place-vob'));

      fireEvent.change(screen.getByTestId('world-place-class'), { target: { value: className } });
      expect(screen.queryByTestId('world-place-instance')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('world-place-confirm'));

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
      const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ op: 'AddVob', to: { class: className, position: TERRAIN } });
      const { to } = ops[0] as { to: Record<string, unknown> };
      expect(to).not.toHaveProperty('instance');
      expect(to).not.toHaveProperty('visual');
    }
  });

  it('will not place an item whose instance the project does not declare', async () => {
    // The same refusal the property grid makes, in the one other place an
    // instance is typed: ZenGin crashes on a name no script declares, and
    // nothing below the renderer holds an index to check it against.
    useProjectStore.setState({
      mergedSemanticModel: {
        ...useProjectStore.getState().mergedSemanticModel,
        items: { ITFO_APPLE: { name: 'ITFO_APPLE' } },
      },
    } as never);
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValue(summary as never);
    api.getWorldVisuals.mockResolvedValue({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    act(() => useWorldStore.getState().selectVob(null));
    fireEvent.click(await screen.findByTestId('world-place-vob'));
    fireEvent.change(screen.getByTestId('world-place-class'), { target: { value: 'oCItem' } });
    fireEvent.change(screen.getByTestId('world-place-instance'), { target: { value: 'ITFO_APPEL' } });

    expect(screen.getByTestId('world-place-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('world-place-confirm'));
    expect(api.applyWorldOps).not.toHaveBeenCalled();

    // Daedalus is case-insensitive, and the index is folded on both sides — so
    // the name the project does declare is placeable however it is typed.
    fireEvent.change(screen.getByTestId('world-place-instance'), { target: { value: 'itfo_apple' } });
    expect(screen.getByTestId('world-place-confirm')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('world-place-confirm'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops[0]).toMatchObject({ to: { class: 'oCItem', instance: 'itfo_apple' } });
  });

  it('clears the selection after an op that renumbers, and keeps it otherwise', async () => {
    // A selection is a list of flat indices, and after a reparent or a parented
    // add there is no telling which VOB one of them now names — the property
    // grid would describe a VOB the user never picked. An appended root
    // renumbers nothing, so that selection is still the same VOBs.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValue(summary as never);
    api.getWorldVisuals.mockResolvedValue({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    await place('NW_CRATE.3DS');
    await waitFor(() => expect(api.refreshWorldIndex).toHaveBeenCalled());
    act(() => useWorldStore.getState().selectVob(1));
    expect(useWorldStore.getState().selection).toEqual([1]);

    fireEvent.dragStart(screen.getByTestId('world-vob-row-1'));
    fireEvent.drop(screen.getByTestId('world-vob-row-0'));

    await waitFor(() => expect(useWorldStore.getState().selection).toEqual([]));
  });

  it('fits the box from the visual placed at that point, not the binding default', async () => {
    // The engine culls by the box, and the binding's fallback is a 10 cm cube —
    // which would cull a house. The bounds are the visual's own, in the visual's
    // own space, so they have to be placed at the position before they mean
    // anything.
    const summary = await openWorld();
    api.getVisualBounds.mockResolvedValueOnce([-100, 0, -100, 100, 250, 100]);
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    await place('NW_HOUSE.3DS');

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect((ops[0] as { to: { bbox: number[] } }).to.bbox).toEqual([
      TERRAIN[0] - 100, TERRAIN[1], TERRAIN[2] - 100,
      TERRAIN[0] + 100, TERRAIN[1] + 250, TERRAIN[2] + 100,
    ]);
  });

  it('carries no box for a visual that does not resolve', async () => {
    // A misspelling, a decal's texture, a `.pfx`. There is nothing to fit, and
    // the binding's own default is the honest answer rather than a guess.
    const summary = await openWorld();
    api.getVisualBounds.mockResolvedValueOnce(null);
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    await place('NOT_A_VISUAL.3DS');

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect((ops[0] as { to: Record<string, unknown> }).to).not.toHaveProperty('bbox');
  });

  it('re-reads the index and the visuals, because a structural edit renumbers', async () => {
    // The projection cannot be patched: a flat index is a position in a
    // depth-first traversal. And an instance cannot be appended to an
    // `InstancedMesh` that is already allocated, so the scene rebuilds too.
    const summary = await openWorld();
    const grown = { ...summary, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30], TERRAIN]) };
    api.refreshWorldIndex.mockResolvedValueOnce(grown as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    await place('NW_CRATE.3DS');

    await waitFor(() => expect(api.refreshWorldIndex).toHaveBeenCalled());
    await waitFor(() => expect(useWorldStore.getState().summary).toBe(grown));
    expect(api.getWorldVisuals).toHaveBeenCalledTimes(2);   // the open, then this
  });

  it('reparents a VOB dragged onto another row, as one op alone in its batch', async () => {
    // The scene tree's drag and drop, through the surface it is wired to. One
    // op and nothing else in the batch: a reparent renumbers every path after
    // it, and the other ops in a batch carry paths resolved before it ran.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.dragStart(screen.getByTestId('world-vob-row-1'));
    fireEvent.drop(screen.getByTestId('world-vob-row-0'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const ops = api.applyWorldOps.mock.calls.at(-1)![0] as WorldOp[];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      op: 'ReparentVob',
      vob: 1,
      from: { path: '1', parentPath: null, slot: 1 },
      to: { path: '0/0', parentPath: '0', slot: 0 },
    });

    // And it refreshes like any other structural edit, because the columnar
    // projection cannot reorder itself.
    await waitFor(() => expect(api.refreshWorldIndex).toHaveBeenCalled());
  });

  it('reparents to a position between rows, including back out to the roots', async () => {
    // The half a drop *onto* a row cannot express: there is no row that means
    // "a root", so before the insertion line existed the only way into the root
    // list was to have never left it. The null parent goes all the way through —
    // the op, the IPC validator and the binding all take one.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.dragStart(screen.getByTestId('world-vob-row-1'));
    fireEvent.drop(screen.getByTestId('world-vob-drop-before-0'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const ops = api.applyWorldOps.mock.calls.at(-1)![0] as WorldOp[];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      op: 'ReparentVob',
      vob: 1,
      from: { path: '1', parentPath: null, slot: 1 },
      to: { path: '0', parentPath: null, slot: 0 },
    });
  });

  it('does not re-read anything when the edit was refused', async () => {
    await openWorld();
    api.applyWorldOps.mockRejectedValueOnce(new Error('no vob at 2') as never);

    await place('NW_CRATE.3DS');

    await waitFor(() => expect(screen.getByTestId('world-edit-error')).toBeInTheDocument());
    expect(api.refreshWorldIndex).not.toHaveBeenCalled();
  });

  it('re-reads on undo too, because an undone placement is just as structural', async () => {
    // Undo does not go through `commitOps`: the op log lives in the main
    // process, so the keyboard handler asks it what it undid and applies that.
    // Without the same refresh, the VOB is gone from the world and the
    // renderer's index still has it — and every index after it would be wrong
    // if the op had not been an append.
    const summary = await openWorld();
    const shrunk = { ...summary, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]) };
    api.undoWorldEdit.mockResolvedValueOnce([
      { op: 'AddVob', vob: 2, path: '2', from: { position: [1, 2, 3] }, to: null },
    ] as never);
    api.refreshWorldIndex.mockResolvedValueOnce(shrunk as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => expect(api.refreshWorldIndex).toHaveBeenCalled());
    await waitFor(() => expect(useWorldStore.getState().summary).toBe(shrunk));
  });

  it('does not re-read on an undo that was not structural', async () => {
    // A move is patched into the columns in place, which is the whole reason
    // the projection exists — re-reading 1.69 MB for every Ctrl+Z would undo
    // that.
    await openWorld();
    api.undoWorldEdit.mockResolvedValueOnce([MOVE] as never);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => expect(api.undoWorldEdit).toHaveBeenCalled());
    expect(api.refreshWorldIndex).not.toHaveBeenCalled();
  });

  it('reserves the placement button’s own height, not a pixel count of its own', async () => {
    // The row must be the same height before and after a pick, and it used to
    // buy that with a hard-coded 31 px read off MUI's small-button metrics —
    // a number that drifts silently the moment a theme sets a button height,
    // and jsdom has no layout, so no test can catch the drift. The reservation
    // is a real small button instead, hidden and inert: it cannot disagree with
    // the buttons it stands in for, whatever the theme says they are.
    await openWorld();
    const spacer = screen.getByTestId('world-terrain-bar-spacer');
    expect(spacer.className).toContain('MuiButton-sizeSmall');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));

    // And it gives way to the buttons themselves — same component, same size.
    const placed = await screen.findByTestId('world-place-vob');
    expect(placed.className).toContain('MuiButton-sizeSmall');
    expect(screen.queryByTestId('world-terrain-bar-spacer')).toBeNull();
  });

  it('keeps the bar mounted, so a pick does not resize the viewport under the click', async () => {
    // Mounting the bar on the first terrain hit shortened the viewport by its
    // height the moment a point landed, which moves the picture out from under
    // the cursor that picked it. So it is there before the first pick, and it
    // is the *same* element after — a remount is the same shove.
    await openWorld();
    const before = screen.getByTestId('world-terrain-bar');

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));

    expect(await screen.findByTestId('world-place-vob')).toBeInTheDocument();
    expect(screen.getByTestId('world-terrain-bar')).toBe(before);
  });

  it('tells the viewport where to draw the point the bar names', async () => {
    // "Place VOB here…" names coordinates, and coordinates are not a place
    // anybody can see. The viewport draws a marker there; this is the only
    // seam between the two.
    await openWorld();
    expect(mockTerrainPoint).toBeNull();

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    await waitFor(() => expect(mockTerrainPoint).toEqual(TERRAIN));

    // And it goes away with the point: a hit on a VOB is not a point on the
    // ground, and a marker left behind names a placement that is no longer on
    // offer.
    fireEvent.click(screen.getByTestId('stub-pick-vob'));
    await waitFor(() => expect(screen.queryByTestId('world-place-vob')).not.toBeInTheDocument());
    expect(mockTerrainPoint).toBeNull();
  });

  it('cannot be reached without a point to place at', async () => {
    // The position is the one thing the surface cannot invent: a VOB placed at
    // the origin is 55 metres under the terrain on retail NewWorld.
    await openWorld();
    expect(screen.queryByTestId('world-place-vob')).not.toBeInTheDocument();
  });
});

describe('undo and redo in the World view', () => {
  const pressUndo = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  const pressRedo = () => fireEvent.keyDown(window, { key: 'y', ctrlKey: true });

  it('applies whatever the main process says it undid', async () => {
    // Not "whatever the renderer thinks it sent": the op log lives in the main
    // process (§7) and it is the one that decides what an undo *is*.
    const summary = await openWorld();
    const inverse: WorldOp = { ...MOVE, from: [11, 22, 33], to: [10, 20, 30] };
    useWorldStore.getState().applyEdit([MOVE]);
    api.undoWorldEdit.mockResolvedValueOnce([inverse]);

    pressUndo();

    await waitFor(() => expect(createVobReader(summary.vobIndex).position(1)).toEqual([10, 20, 30]));
    expect(mockAppliedOps).toEqual([inverse]);
  });

  it('redoes on Ctrl+Y and on Ctrl+Shift+Z', async () => {
    await openWorld();

    pressRedo();
    await waitFor(() => expect(api.redoWorldEdit).toHaveBeenCalledTimes(1));

    // `Z`, not `z`: with Shift held that is what a browser actually reports,
    // and a handler comparing against the lower-case letter never fires.
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(api.redoWorldEdit).toHaveBeenCalledTimes(2));
    expect(api.undoWorldEdit).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing left to undo', async () => {
    const summary = await openWorld();
    api.undoWorldEdit.mockResolvedValueOnce(null);

    pressUndo();

    await waitFor(() => expect(api.undoWorldEdit).toHaveBeenCalled());
    expect(createVobReader(summary.vobIndex).position(1)).toEqual([10, 20, 30]);
    expect(mockAppliedOps).toBeNull();
  });

  it('is not bound while the surface is hidden behind another view', async () => {
    // The surface is kept mounted when you navigate away from it
    // (`docs/refactoring-targets.md` §8), and its shortcut is a *window*
    // listener — so without this, Ctrl+Z in the dialog view would undo a world
    // edit as well as the dialog edit `MainLayout` performs.
    await openWorld();
    act(() => { lastRender.rerender(<WorldSurface hidden />); });

    pressUndo();
    pressRedo();

    expect(api.undoWorldEdit).not.toHaveBeenCalled();
    expect(api.redoWorldEdit).not.toHaveBeenCalled();

    // And it is bound again when the view comes back.
    act(() => { lastRender.rerender(<WorldSurface />); });
    pressUndo();
    await waitFor(() => expect(api.undoWorldEdit).toHaveBeenCalledTimes(1));
  });

  it('is not bound at all while no world is open', async () => {
    // The shortcut is a window listener and the World view can be on screen
    // with nothing in it.
    useWorldStore.getState().reset();
    // Awaited: the surface asks for the configured Gothic install on mount, and
    // that answer arriving after the test ends is an update outside `act`.
    await act(async () => { render(<WorldSurface />); });

    pressUndo();

    expect(api.undoWorldEdit).not.toHaveBeenCalled();
  });
});

describe('a waypoint dragged in the viewport', () => {
  /**
   * Open a world and turn the waynet on, which is what fetches the payload.
   *
   * A waypoint cannot be picked before that, and deliberately: the overlay is
   * the only thing that draws one, and it is off until asked for.
   */
  async function openWithWaynet(): Promise<WaynetPayload> {
    await openWorld();
    const payload = waynetPayload();
    api.getWorldWaynet.mockResolvedValueOnce(payload as never);

    fireEvent.click(screen.getByTestId('world-waynet-toggle'));
    await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalled());
    return payload;
  }

  it('becomes a MoveWaypoint carrying where it was, and reaches the main process', async () => {
    // The name rides along with the index because a stale index always resolves
    // to *some* waypoint and moves it, where a stale path resolves to nothing.
    // One string compare is the only guard the address admits.
    await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([WAYPOINT_MOVE]));
  });

  it('writes the committed move into the payload the overlay draws', async () => {
    // The overlay's position attribute is a view over this very buffer, so this
    // is what makes the moved waypoint — and every edge into it — stay where it
    // was put. Nothing else writes it: the VOB projection has no row for a
    // waypoint and refuses the op by name.
    const payload = await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));

    await waitFor(() => expect(Array.from(new Float32Array(payload.positions).slice(3, 6)))
      .toEqual(WAYPOINT_TO));
  });

  it('does not touch the payload until the main process has taken the op', async () => {
    const payload = await openWithWaynet();
    let take = (): void => undefined;
    api.applyWorldOps.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      take = () => resolve(undefined);
    }));

    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(Array.from(new Float32Array(payload.positions).slice(3, 6))).toEqual(WAYPOINT_WAS);

    take();
    await waitFor(() => expect(Array.from(new Float32Array(payload.positions).slice(3, 6)))
      .toEqual(WAYPOINT_TO));
  });

  it('puts the waypoint back when the op is refused, and says so', async () => {
    // The viewport has already drawn the drag into the payload. Left alone the
    // waypoint sits where the world does not have it, and it is the *file* that
    // would disagree — a waypoint has no property grid to notice it.
    const payload = await openWithWaynet();
    api.applyWorldOps.mockRejectedValueOnce(new Error('waypoint 1 is not WP_MIDDLE'));

    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));

    await waitFor(() => expect(mockAppliedOps)
      .toEqual([{ ...WAYPOINT_MOVE, from: WAYPOINT_TO, to: WAYPOINT_WAS }]));
    expect(Array.from(new Float32Array(payload.positions).slice(3, 6))).toEqual(WAYPOINT_WAS);
    expect(await screen.findByTestId('world-edit-error')).toHaveTextContent('WP_MIDDLE');
  });

  it('is undone through the same path a VOB move is', async () => {
    // Undo does not go back through `commitOps` — the op log is in the main
    // process and it says what it undid. An undone waypoint move has to reach
    // the payload the same way the commit did, or the overlay keeps drawing the
    // move after the world has dropped it.
    const payload = await openWithWaynet();
    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));
    await waitFor(() => expect(Array.from(new Float32Array(payload.positions).slice(3, 6)))
      .toEqual(WAYPOINT_TO));

    api.undoWorldEdit.mockResolvedValueOnce(
      [{ ...WAYPOINT_MOVE, from: WAYPOINT_TO, to: WAYPOINT_WAS }] as never,
    );
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => expect(Array.from(new Float32Array(payload.positions).slice(3, 6)))
      .toEqual(WAYPOINT_WAS));
  });

  it('does not ask for a fresh VOB index — a waypoint renumbers nothing', async () => {
    // A waynet op is not structural: it changes no enumeration, so the columnar
    // projection and the instanced scene are both still correct. Re-reading
    // either would cost what an open costs, and would re-frame the camera away
    // from the waypoint that was just dragged.
    await openWithWaynet();
    api.refreshWorldIndex.mockClear();
    api.getWorldVisuals.mockClear();

    fireEvent.click(screen.getByTestId('stub-drag-waypoint'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(api.refreshWorldIndex).not.toHaveBeenCalled();
    expect(api.getWorldVisuals).not.toHaveBeenCalled();
  });

  it('lets go of the waypoint when the overlay is switched off', async () => {
    // The overlay is hidden, not destroyed, so nothing else would notice. A
    // gizmo left standing on a waypoint that is no longer drawn is a gizmo in
    // mid-air — and it is still draggable, which would commit a move to a
    // waypoint the user cannot see.
    await openWithWaynet();
    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
    await waitFor(() => expect(mockSelectedWaypoint).toBe(1));

    fireEvent.click(screen.getByTestId('world-waynet-toggle'));

    await waitFor(() => expect(mockSelectedWaypoint).toBeNull());
  });

  it('hands the picked waypoint back down, and lets go of the VOB selection', async () => {
    // One gizmo. The VOB selection standing behind a selected waypoint is what
    // would make the Delete VOB button act on something invisible.
    await openWithWaynet();
    expect(mockSelection).toEqual([1]);

    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));

    await waitFor(() => expect(mockSelectedWaypoint).toBe(1));
    expect(mockSelection).toEqual([]);
  });

  it('shows the routines that name the selected waypoint, from the project-wide index', async () => {
    // §16.8 W2: the panel is the only UI a selected waypoint has, and the
    // index it reads is keyed uppercase — the routine's own case is kept.
    useProjectStore.setState({
      waypointSiteIndex: {
        WP_MIDDLE: [{ filePath: 'C:/Story/TA_Baker.d', functionName: 'TA_Baker_Day' }],
      },
    } as never);
    await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));

    // The name is the rename field's value since W1, not text content.
    expect(await screen.findByDisplayValue('WP_MIDDLE')).toBeInTheDocument();
    expect(screen.getByTestId('world-waypoint-panel')).toHaveTextContent('TA_Baker_Day');
    expect(screen.getByTestId('world-waypoint-panel')).toHaveTextContent('TA_Baker.d');
  });

  it('says no routine names the waypoint when the index has none', async () => {
    await openWithWaynet();

    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));

    expect(await screen.findByTestId('world-waypoint-panel')).toHaveTextContent(/no script in this project/i);
  });

  describe('renamed in that panel', () => {
    // W1 (§16.7). The panel is the only UI a waypoint has, so it is where the
    // one waynet edit that is not a drag lives.
    const nameField = () => screen.getByTestId('world-waypoint-name-input') as HTMLInputElement;

    async function pickWaypoint(): Promise<WaynetPayload> {
      const payload = await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
      await screen.findByTestId('world-waypoint-panel');
      return payload;
    }

    const commitName = (value: string) => {
      fireEvent.change(nameField(), { target: { value } });
      fireEvent.blur(nameField());
    };

    it('becomes a RenameWaypoint carrying the name it replaces', async () => {
      // `from` is the guard as well as the origin: a bare index always resolves
      // to *some* waypoint, so the name it had is the only check the address
      // admits.
      await pickWaypoint();

      commitName('WP_RENAMED');

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
        op: 'RenameWaypoint', waypoint: 1, from: 'WP_MIDDLE', to: 'WP_RENAMED',
      }]));
    });

    it('writes the committed name into the payload the panel reads', async () => {
      // Nothing else does. The VOB projection has no row for a waypoint and
      // refuses the op by name, so without this the panel keeps showing the old
      // name until the world is re-opened.
      await pickWaypoint();

      commitName('WP_RENAMED');

      expect(await screen.findByDisplayValue('WP_RENAMED')).toBeInTheDocument();
    });

    it('commits nothing for a name that did not change, or an empty one', async () => {
      await pickWaypoint();

      commitName('WP_MIDDLE');
      commitName('');

      expect(api.applyWorldOps).not.toHaveBeenCalled();
    });

    it('puts the name back when the op is refused, and says so', async () => {
      // A rename the world refused — a duplicate, say — leaves the panel naming
      // a waypoint the file does not have.
      await pickWaypoint();
      api.applyWorldOps.mockRejectedValueOnce(new Error('waypoint 2 is already named WP_TAKEN'));

      commitName('WP_TAKEN');

      expect(await screen.findByTestId('world-edit-error')).toHaveTextContent('WP_TAKEN');
      await waitFor(() => expect(nameField().value).toBe('WP_MIDDLE'));
    });

    it('is undone through the same path a waypoint move is', async () => {
      await pickWaypoint();
      commitName('WP_RENAMED');
      await screen.findByDisplayValue('WP_RENAMED');

      api.undoWorldEdit.mockResolvedValueOnce([{
        op: 'RenameWaypoint', waypoint: 1, from: 'WP_RENAMED', to: 'WP_MIDDLE',
      }] as never);
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

      expect(await screen.findByDisplayValue('WP_MIDDLE')).toBeInTheDocument();
    });
  });

  describe('added at the picked terrain point', () => {
    // W2 (§16.7). It appends, so it renumbers nothing and needs no addressing
    // scheme of its own — and it is offered only while the overlay is on,
    // because the overlay is the only thing that draws the result.
    async function addWaypoint(name?: string) {
      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      fireEvent.click(await screen.findByTestId('world-add-waypoint'));

      if (name !== undefined) {
        fireEvent.change(screen.getByTestId('world-waypoint-add-name'), {
          target: { value: name },
        });
      }
      fireEvent.click(screen.getByTestId('world-waypoint-add-confirm'));
    }

    it('becomes an AddWaypoint one past the end, with a null origin', async () => {
      // The null side is what makes the inverse a removal with no op of its
      // own, exactly as it is for a placed VOB.
      await openWithWaynet();

      await addWaypoint('FP_ADDED');

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
        op: 'AddWaypoint', waypoint: 3, name: 'FP_ADDED', from: null, to: TERRAIN,
      }]));
    });

    it('suggests a free-point name, because a name is the only field it has', async () => {
      await openWithWaynet();

      await addWaypoint();

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([
        expect.objectContaining({ op: 'AddWaypoint', name: 'FP_NEW_3' }),
      ]));
    });

    it('refuses a name the payload already carries before the round trip', async () => {
      await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      fireEvent.click(await screen.findByTestId('world-add-waypoint'));

      fireEvent.change(screen.getByTestId('world-waypoint-add-name'), {
        target: { value: 'WP_MIDDLE' },
      });

      expect(screen.getByTestId('world-waypoint-add-confirm')).toBeDisabled();
    });

    it('re-reads the overlay payload, which is the only thing that can grow it', async () => {
      // The positions column is a typed array the point cloud draws through and
      // it cannot be appended to — and the VOB projection has no row for a
      // waypoint at all. Nothing but a fresh payload puts the new one on screen.
      await openWithWaynet();
      const grown = waynetPayload();
      api.getWorldWaynet.mockResolvedValueOnce(grown as never);

      await addWaypoint('FP_ADDED');

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));
    });

    it('is not offered while the waynet overlay is off', async () => {
      // Nothing would draw the waypoint, and the gizmo could not reach it.
      await openWorld();
      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));

      expect(await screen.findByTestId('world-place-vob')).toBeInTheDocument();
      expect(screen.queryByTestId('world-add-waypoint')).not.toBeInTheDocument();
    });

    it('re-reads the payload on undo too, and lets go of the waypoint', async () => {
      // Undo removes the tail. A gizmo left standing on it would be sitting on
      // an index the waynet no longer has.
      await openWithWaynet();
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);
      await addWaypoint('FP_ADDED');
      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));
      fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
      await waitFor(() => expect(mockSelectedWaypoint).toBe(1));

      api.undoWorldEdit.mockResolvedValueOnce([{
        op: 'AddWaypoint', waypoint: 3, name: 'FP_ADDED', from: TERRAIN, to: null,
      }] as never);
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(3));
      expect(mockSelectedWaypoint).toBeNull();
    });
  });

  describe('joined and unjoined in that panel', () => {
    // W3 (§16.7). An edge needs a *second* waypoint and the surface has one
    // selection, so the second end is named in the panel rather than picked in
    // the viewport. The fixture waynet is a chain: WP_START–WP_MIDDLE–WP_END.
    async function pickMiddle(): Promise<WaynetPayload> {
      const payload = await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
      await screen.findByTestId('world-waypoint-panel');
      return payload;
    }

    /** The panel with `WP_START` selected — the end of the chain, so `WP_END`
     *  is a waypoint it is *not* already joined to. */
    async function pickStart(): Promise<void> {
      await openWithWaynet();
      act(() => useWorldStore.getState().selectWaypoint(0));
      await screen.findByTestId('world-waypoint-panel');
    }

    const typeJoin = (value: string) => {
      fireEvent.change(screen.getByTestId('world-waypoint-join-name'), {
        target: { value },
      });
    };

    it('lists the far end of every edge the selected waypoint is in', async () => {
      // Read out of the same flat pair buffer the overlay draws its lines
      // through, in both orientations: the fixture stores 0–1 and 1–2, and the
      // middle waypoint is the far end of one and the near end of the other.
      await pickMiddle();

      const edges = await screen.findByTestId('world-waypoint-edges');
      expect(edges).toHaveTextContent('WP_START');
      expect(edges).toHaveTextContent('WP_END');
      expect(edges).not.toHaveTextContent('WP_MIDDLE');
    });

    it('becomes a SetWaypointEdge with both ends guarded, taking the edge away', async () => {
      await pickMiddle();

      fireEvent.click(screen.getByTestId('world-waypoint-disconnect-0'));

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
        op: 'SetWaypointEdge',
        a: 1, aName: 'WP_MIDDLE', b: 0, bName: 'WP_START',
        from: true, to: false,
      }]));
    });

    it('becomes the same op the other way round for a named waypoint', async () => {
      // Case-insensitively, like every other by-name lookup a waypoint has —
      // the routine index is keyed uppercase for the same reason.
      await pickStart();

      typeJoin('wp_end');
      fireEvent.click(screen.getByTestId('world-waypoint-connect'));

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
        op: 'SetWaypointEdge',
        a: 0, aName: 'WP_START', b: 2, bName: 'WP_END',
        from: false, to: true,
      }]));
    });

    it('offers no join for a name the waynet has not got, the waypoint itself, or a neighbour', async () => {
      // All three are refusals the binding makes too. Dead button rather than a
      // round trip: this side is holding the very list that decides.
      await pickStart();

      typeJoin('WP_NOWHERE');
      expect(screen.getByTestId('world-waypoint-connect')).toBeDisabled();
      typeJoin('WP_START');
      expect(screen.getByTestId('world-waypoint-connect')).toBeDisabled();
      typeJoin('WP_MIDDLE');
      expect(screen.getByTestId('world-waypoint-connect')).toBeDisabled();

      typeJoin('WP_END');
      expect(screen.getByTestId('world-waypoint-connect')).toBeEnabled();
      expect(api.applyWorldOps).not.toHaveBeenCalled();
    });

    it('re-reads the overlay payload, which is the only thing that draws the line', async () => {
      // The edge buffer is a typed array the lines are built from and it cannot
      // gain a pair in place — and a removal can promote an endpoint to a free
      // point, which is a flags column nothing else rewrites.
      await pickMiddle();
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);

      fireEvent.click(screen.getByTestId('world-waypoint-disconnect-2'));

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));
    });

    it('re-reads it on undo too, which arrives as the same op swapped', async () => {
      await pickMiddle();
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);
      fireEvent.click(screen.getByTestId('world-waypoint-disconnect-2'));
      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));

      api.undoWorldEdit.mockResolvedValueOnce([{
        op: 'SetWaypointEdge',
        a: 1, aName: 'WP_MIDDLE', b: 2, bName: 'WP_END',
        from: false, to: true,
      }] as never);
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(3));
      // The waypoint keeps its gizmo: an edge renumbers nothing, so the index
      // the selection stands on still names what it named before.
      expect(mockSelectedWaypoint).toBe(1);
    });
  });

  describe('deleted in that panel', () => {
    // W4 (§16.7) — the one waynet op that renumbers, so the one that arrives
    // with §15's barrier: the undo history goes with it and the user is told
    // first, exactly as a VOB delete does. It lives in the panel for W1's
    // reason — that is the only UI a waypoint has.
    async function pickMiddle(): Promise<WaynetPayload> {
      const payload = await openWithWaynet();
      fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
      await screen.findByTestId('world-waypoint-panel');
      return payload;
    }

    /** Ask to delete the selected waypoint, without confirming. */
    async function askToDelete(): Promise<void> {
      fireEvent.click(await screen.findByTestId('world-waypoint-delete'));
    }

    it('is a DeleteWaypoint guarded by the name, once the warning is confirmed', async () => {
      await pickMiddle();
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);

      await askToDelete();
      fireEvent.click(screen.getByTestId('world-waypoint-delete-confirm'));

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
        op: 'DeleteWaypoint', waypoint: 1, name: 'WP_MIDDLE',
      }]));
    });

    it('warns that the edit cannot be undone and that the history goes with it', async () => {
      // The requirement §15 put in place of an inverse, and the same one a VOB
      // delete carries: every other edit in this surface undoes, so the thing
      // the user has to be told is that this one clears the stack.
      await pickMiddle();

      await askToDelete();

      const warning = screen.getByTestId('world-waypoint-delete-warning');
      expect(warning).toHaveTextContent(/cannot be undone/i);
      expect(warning).toHaveTextContent(/undo history|undo stack|earlier edits/i);
      // And that the edges go too — the part a user cannot see coming from the
      // point on screen.
      expect(warning).toHaveTextContent(/edge/i);
      expect(api.applyWorldOps).not.toHaveBeenCalled();
    });

    it('sends nothing when the warning is dismissed', async () => {
      await pickMiddle();

      await askToDelete();
      fireEvent.click(screen.getByTestId('world-waypoint-delete-cancel'));

      expect(api.applyWorldOps).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByTestId('world-waypoint-delete-warning'))
        .not.toBeInTheDocument());
    });

    it('re-reads the overlay payload and lets go of the waypoint, because it renumbers', async () => {
      // Every index after the deleted waypoint names a different one now, so a
      // gizmo left standing would be on somebody else — and the payload cannot
      // shrink in place any more than it can grow.
      await pickMiddle();
      api.getWorldWaynet.mockResolvedValueOnce(waynetPayload() as never);

      await askToDelete();
      fireEvent.click(screen.getByTestId('world-waypoint-delete-confirm'));

      await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalledTimes(2));
      expect(mockSelectedWaypoint).toBeNull();
      // The VOB enumeration is untouched — a waypoint has no row in it.
      expect(api.refreshWorldIndex).not.toHaveBeenCalled();
    });

    it('says so and changes nothing when the main process refuses it', async () => {
      await pickMiddle();
      api.applyWorldOps.mockRejectedValueOnce(new Error('waypoint 1 is WP_OTHER'));

      await askToDelete();
      fireEvent.click(screen.getByTestId('world-waypoint-delete-confirm'));

      expect(await screen.findByTestId('world-edit-error')).toHaveTextContent(/WP_OTHER/);
      // Not re-read: nothing was deleted, so the payload on screen is the
      // world's — and the selection is still a waypoint that exists.
      expect(api.getWorldWaynet).toHaveBeenCalledTimes(1);
      expect(mockSelectedWaypoint).toBe(1);
    });
  });
});

describe('a class property edited in the grid', () => {
  /** VOB 1 as a light, with its class fields already on screen. */
  async function openLight() {
    mockVobProps = LIGHT_PROPS;
    const summary = await openWorld('zCVobLight');
    await screen.findByTestId('world-prop-class-range-input');
    return summary;
  }

  const rangeInput = () => screen.getByTestId('world-prop-class-range-input') as HTMLInputElement;
  const commitRange = (value: string) => {
    fireEvent.change(rangeInput(), { target: { value } });
    fireEvent.blur(rangeInput());
  };

  it('reads the primary VOB\'s class fields by its native path', async () => {
    // Not the flat index: a VOB has two addresses (§7) and everything below the
    // renderer resolves the path. And not out of the columnar index at all —
    // it interns a class *name* and carries not one field of the class.
    await openLight();

    expect(api.getVobProps).toHaveBeenCalledWith('1');
    expect(rangeInput().value).toBe('2000');
  });

  it('asks even for a class the catalogue does not have', async () => {
    // It used to ask for nothing here — 35 of the 37 classes in a retail world
    // have no catalogued fields, and a selection moves with every click. The
    // three base fields (§16.17) are on *every* VOB and in none of the index's
    // columns, so the read is what the grid draws them from and skipping it
    // would leave a plain `zCVob` with nothing editable below its flags.
    await openWorld();

    await waitFor(() => expect(api.getVobProps).toHaveBeenCalledWith('1'));
  });

  it('becomes a SetVobClassProp whose `from` is what the read answered', async () => {
    // The `from` side cannot come from the index the way a move's does, and it
    // cannot be read back at apply time either — by then the world holds `to`.
    // The read is what makes the op invertible, which is why the edit waits for
    // it rather than sending `to` alone.
    await openLight();

    commitRange('3000');

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
      op: 'SetVobClassProp',
      vob: 1,
      path: '1',
      className: 'zCVobLight',
      // Only the key that changed. The read answered a colour as well, and an op
      // carrying it would build an inverse restoring a colour nobody edited.
      from: { range: 2000 },
      to: { range: 3000 },
    }]));
  });

  it('reads the fields again when the edit is refused, instead of showing what was typed', async () => {
    // The refusal is the case the columnar edits do not have: a move that is
    // refused is put back by inverting the op, and there is nothing to invert
    // here — the grid is showing a number that only ever existed in an input.
    await openLight();
    api.applyWorldOps.mockRejectedValueOnce(new Error('props.range must be zero or greater'));

    commitRange('3000');

    expect(await screen.findByTestId('world-edit-error')).toHaveTextContent('zero or greater');
    await waitFor(() => expect(rangeInput().value).toBe('2000'));
  });

  it('draws no fields at all while the props still belong to the last VOB', async () => {
    // The fetch lives in an effect, and an effect runs *after* the commit it
    // belongs to — so the render caused by the selection moving reaches the grid
    // with the new VOB and the props of the old one. The grid picks its fields
    // out of the catalogue by the new VOB's class, so it would index an oCItem's
    // `instance` on a light's props, get `undefined`, and throw while rendering:
    // the app-level boundary replaces the whole editor with its fallback.
    //
    // Both directions, because both are a class the catalogue has fields for and
    // neither one's props can stand in for the other's.
    mockVobProps = LIGHT_PROPS;
    await openWorld(['oCItem', 'zCVobLight']);
    await screen.findByTestId('world-prop-class-range-input');

    mockVobProps = ITEM_PROPS;
    await act(async () => { useWorldStore.getState().selectVob(0); });
    expect((screen.getByTestId('world-prop-class-instance-input') as HTMLInputElement).value)
      .toBe('ITMW_1H_SWORD_01');

    mockVobProps = LIGHT_PROPS;
    await act(async () => { useWorldStore.getState().selectVob(1); });
    expect(rangeInput().value).toBe('2000');
  });

  // The base fields that have no column (§16.17, V1). They arrive with the same
  // read the class fields do and are drawn for every class, but they leave as a
  // `SetVobProp` — the op that already writes the name and the six flags.
  const biasInput = () => screen.getByTestId('world-prop-base-bias-input') as HTMLInputElement;

  it('becomes a SetVobProp whose `from` is the base field the read answered', async () => {
    // The index has no column for `bias`, so this `from` cannot come from it the
    // way a flag's does — it is the fetched value, exactly as a class field's is.
    await openWorld();
    await screen.findByTestId('world-prop-base-bias-input');

    fireEvent.change(biasInput(), { target: { value: '7' } });
    fireEvent.blur(biasInput());

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
      op: 'SetVobProp',
      vob: 1,
      path: '1',
      from: { bias: 2 },
      to: { bias: 7 },
      fromBbox: null,
      toBbox: null,
    }]));
  });

  it('reads the base fields again when the edit is refused', async () => {
    // Nothing to invert: the world holds the value it always held, and the grid
    // is showing a number that only ever existed in an input.
    await openWorld();
    await screen.findByTestId('world-prop-base-bias-input');
    api.applyWorldOps.mockRejectedValueOnce(new Error('props.bias must be a whole number 0-31'));

    fireEvent.change(biasInput(), { target: { value: '7' } });
    fireEvent.blur(biasInput());

    expect(await screen.findByTestId('world-edit-error')).toHaveTextContent('0-31');
    await waitFor(() => expect(biasInput().value).toBe('2'));
  });

  // The item index (level-editor.md §14.1; the board's "SetVobClassProp writes
  // oCItem.instance as free text" card). The grid's own tests take the index as
  // a prop; these two are about the wiring that fills it, which is the only
  // place in the app where the World surface reads the dialog side's project
  // model at all.
  const openItem = async () => {
    mockVobProps = ITEM_PROPS;
    await openWorld('oCItem');
    await screen.findByTestId('world-prop-class-instance-input');
  };
  const commitInstance = (value: string) => {
    const field = screen.getByTestId('world-prop-class-instance-input') as HTMLInputElement;
    fireEvent.change(field, { target: { value } });
    fireEvent.blur(field);
  };

  it('never sends an item instance the project does not declare', async () => {
    // The whole point: a typo'd instance is invisible in the viewport, invisible
    // in the file, and crashes ZenGin when the item is spawned. Nothing below
    // this can catch it — the main process holds no item index — so the op must
    // not exist in the first place.
    useProjectStore.setState({
      mergedSemanticModel: {
        ...useProjectStore.getState().mergedSemanticModel,
        items: { ITMW_1H_SWORD_01: { name: 'ITMW_1H_SWORD_01' }, ITMW_2H_AXE_01: { name: 'ITMW_2H_AXE_01' } },
      },
    } as never);
    await openItem();

    commitInstance('ITMW_1H_SWROD_01');

    await waitFor(() => expect(
      (screen.getByTestId('world-prop-class-instance-input') as HTMLInputElement).value,
    ).toBe('ITMW_1H_SWORD_01'));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('sends a declared instance typed in another case, because Daedalus is case-insensitive', async () => {
    // The parser keys `items` by the name as it was *written* — so a script
    // declaring `instance itmw_2h_axe_01(C_Item)` puts a lowercase key in the
    // map, and the folding has to happen on the index side as well as on the
    // typed side. The value committed is still the one the user typed.
    useProjectStore.setState({
      mergedSemanticModel: {
        ...useProjectStore.getState().mergedSemanticModel,
        items: { itmw_2h_axe_01: { name: 'itmw_2h_axe_01' } },
      },
    } as never);
    await openItem();

    commitInstance('ITMW_2H_AXE_01');

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
      op: 'SetVobClassProp',
      vob: 1,
      path: '1',
      className: 'oCItem',
      from: { instance: 'ITMW_1H_SWORD_01' },
      to: { instance: 'ITMW_2H_AXE_01' },
    }]));
  });

  it('reads the fields again after an undo, so the grid follows the world', async () => {
    // An undo does not come back through `commitOps` — the op log is in the main
    // process — and `applyEdit` writes no column for a class field, by design.
    // The read is the only way this side learns the value changed.
    await openLight();
    mockVobProps = { ...LIGHT_PROPS, range: 3000 };

    commitRange('3000');
    await waitFor(() => expect(rangeInput().value).toBe('3000'));

    mockVobProps = LIGHT_PROPS;
    api.undoWorldEdit.mockResolvedValueOnce([{
      op: 'SetVobClassProp',
      vob: 1,
      path: '1',
      className: 'zCVobLight',
      from: { range: 3000 },
      to: { range: 2000 },
    }] as never);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => expect(rangeInput().value).toBe('2000'));
  });
});

describe('jumping to a VOB from the scene tree', () => {
  // Not an edit, but the same seam every edit uses: the shell is what the tree
  // and the viewport reach each other through. The framing itself is
  // `frameVobs` in `cameraNav`, tested against a real camera in
  // `tests/cameraNav.test.ts`, and the handle it is reached through in
  // `tests/WorldViewport.frameHandle.test.tsx`; what is left to pin here is
  // that the command names the VOB that was double-clicked and that the
  // selection follows it.
  it('asks the viewport for the double-clicked VOB, and selects it', async () => {
    // VOB 1 is selected by `openWorld`, so a command that merely repeated the
    // selection — or a tree that reported its row — would not say 0 here.
    await openWorld();
    expect(useWorldStore.getState().selection).toEqual([1]);

    fireEvent.doubleClick(screen.getByTestId('world-vob-row-0'));

    await waitFor(() => expect(mockFrameVob).toHaveBeenCalledWith(0));
    expect(useWorldStore.getState().selection).toEqual([0]);
  });

  it('asks again every time, so the same VOB can be jumped to twice', async () => {
    // A command, not a state: the second double-click on an already-framed VOB
    // has to move the camera, which is exactly when it is asked for — after
    // the camera has wandered off.
    await openWorld();

    fireEvent.doubleClick(screen.getByTestId('world-vob-row-0'));
    await waitFor(() => expect(mockFrameVob).toHaveBeenCalledTimes(1));

    fireEvent.doubleClick(screen.getByTestId('world-vob-row-0'));
    await waitFor(() => expect(mockFrameVob).toHaveBeenCalledTimes(2));
    expect(mockFrameVob.mock.calls).toEqual([[0], [0]]);
  });
});

// Snapping's per-VOB half (level-editor.md §16.5): unlike the gizmo, which
// drives the whole selection from one shared delta, a drop or an align finds
// each VOB's own ground point or own normal through a raycast the shell asks
// the viewport for directly, then builds one batch through `dropVobsToGround`
// or `alignVobsToNormal` — the same commit path as every other edit here.
describe('drop to ground', () => {
  it('is disabled with nothing selected, and reachable with something', async () => {
    await openWorld();
    act(() => useWorldStore.getState().selectVob(null));
    expect(screen.getByTestId('world-drop-to-ground')).toBeDisabled();

    // Awaited: every selection issues the per-VOB props read, and its answer
    // lands a microtask later — outside an `act` that has already returned.
    await act(async () => { useWorldStore.getState().selectVob(1); });
    expect(screen.getByTestId('world-drop-to-ground')).toBeEnabled();
  });

  it('casts down from the VOB\'s own position and commits a MoveVob to the hit point', async () => {
    const summary = await openWorld();
    mockRaycastDown.mockReturnValueOnce({ point: [10, 5, 30], normal: [0, 1, 0] });

    fireEvent.click(screen.getByTestId('world-drop-to-ground'));

    expect(mockRaycastDown).toHaveBeenCalledWith([10, 20, 30]);
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([
      { op: 'MoveVob', vob: 1, path: '1', from: [10, 20, 30], to: [10, 5, 30] },
    ]));
    expect(createVobReader(summary.vobIndex).position(1)).toEqual([10, 5, 30]);
  });

  it('is one batch for a multi-selection, each VOB cast from its own position', async () => {
    await openWorld();
    act(() => useWorldStore.getState().toggleVob(0));
    mockRaycastDown.mockImplementation((origin) => ({ point: [origin[0], 0, origin[2]], normal: [0, 1, 0] }));

    fireEvent.click(screen.getByTestId('world-drop-to-ground'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    expect(api.applyWorldOps).toHaveBeenCalledWith([
      { op: 'MoveVob', vob: 1, path: '1', from: [10, 20, 30], to: [10, 0, 30] },
      { op: 'MoveVob', vob: 0, path: '0', from: [0, 0, 0], to: [0, 0, 0] },
    ]);
  });

  it('sends no op at all when nothing was hit — over the sky, off the mesh', async () => {
    await openWorld();
    mockRaycastDown.mockReturnValueOnce(null);

    fireEvent.click(screen.getByTestId('world-drop-to-ground'));

    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });
});

describe('align to normal', () => {
  it('is disabled with nothing selected, and reachable with something', async () => {
    await openWorld();
    act(() => useWorldStore.getState().selectVob(null));
    expect(screen.getByTestId('world-align-to-normal')).toBeDisabled();

    await act(async () => { useWorldStore.getState().selectVob(1); });
    expect(screen.getByTestId('world-align-to-normal')).toBeEnabled();
  });

  it('turns local +Y onto the raycast\'s normal, refitting the box like any rotate', async () => {
    // VOB 1 sits at [10, 20, 30] with identity rotation and the bounds
    // `openWorld` gives it, [-1, 0, -10, 1, 2, 10] — the same fixture
    // `ops.test.ts`'s "rotates local +Y onto the given normal" uses, so the
    // matrix is the one already proven there.
    const summary = await openWorld();
    mockRaycastDown.mockReturnValueOnce({ point: [10, 5, 30], normal: [1, 0, 0] });

    fireEvent.click(screen.getByTestId('world-align-to-normal'));

    expect(mockRaycastDown).toHaveBeenCalledWith([10, 20, 30]);
    const identity: ZenRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const to: ZenRotation = [0, 1, 0, -1, 0, 0, 0, 0, 1];
    const bounds: [number, number, number, number, number, number] = [-1, 0, -10, 1, 2, 10];
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([{
      op: 'RotateVob',
      vob: 1,
      path: '1',
      from: identity,
      to,
      fromBbox: placeBounds(bounds, identity, [10, 20, 30]),
      toBbox: placeBounds(bounds, to, [10, 20, 30]),
    }]));
    expect(createVobReader(summary.vobIndex).rotation(1)).toEqual(to);
  });

  it('sends no op at all when nothing was hit', async () => {
    await openWorld();
    mockRaycastDown.mockReturnValueOnce(null);

    fireEvent.click(screen.getByTestId('world-align-to-normal'));

    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });
});
