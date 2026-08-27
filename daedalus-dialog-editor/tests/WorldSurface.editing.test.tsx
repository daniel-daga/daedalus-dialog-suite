import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createVobReader, type VobIndex, type WorldOp } from 'zen-world';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
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
let mockFrameRequest: { vob: number } | null | undefined;
/** What the viewport is told to draw a marker at. */
let mockTerrainPoint: [number, number, number] | null | undefined;
/** How bright the viewport is told to draw. */
let mockExposure: number | undefined;
/** The steps the viewport is told to quantise a drag to. */
let mockSnapGrid: number | undefined;
let mockSnapAngle: number | undefined;
/** A quarter turn about Y, row-major — asymmetric, so a transpose would show. */
const TURN: number[] = [0, 0, 1, 0, 1, 0, -1, 0, 0];
// The house pattern for react-window under jsdom, which has no layout — without
// it the scene tree renders no rows at all and the drag-and-drop test below has
// nothing to drag.
jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

jest.mock('../src/renderer/components/world/WorldViewport', () => ({
  __esModule: true,
  default: (props: {
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
    frameRequest: { vob: number } | null;
    terrainPoint: [number, number, number] | null;
    exposure: number;
    snapGrid: number;
    snapAngle: number;
    onSelectWaypoint: (waypoint: number | null) => void;
    onMoveWaypoint: (
      waypoint: number,
      from: [number, number, number],
      to: [number, number, number],
    ) => void;
  }) => {
    mockAppliedOps = props.appliedOps;
    mockSelection = props.selection;
    mockGizmoMode = props.gizmoMode;
    mockSelectedWaypoint = props.selectedWaypoint;
    mockFrameRequest = props.frameRequest;
    mockTerrainPoint = props.terrainPoint;
    mockExposure = props.exposure;
    mockSnapGrid = props.snapGrid;
    mockSnapAngle = props.snapAngle;
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
  },
}));

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
): VobIndex {
  const count = positions.length;
  const columns = new Float32Array(count * 3);
  positions.forEach((position, i) => columns.set(position, i * 3));
  const childIndex = new Uint32Array(count);
  childIndex.forEach((_, i) => { childIndex[i] = i; });
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
    parent: new Int32Array(count).fill(-1).buffer,
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
let mockVobProps: Record<string, unknown> = { class: 'zCVob' };
const LIGHT_PROPS = { class: 'zCVobLight', range: 2000, color: [255, 220, 180, 255] };
const ITEM_PROPS = { class: 'oCItem', instance: 'ITMW_1H_SWORD_01' };

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
async function openWorld(cls?: string | readonly string[]) {
  const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]], cls) };
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

  render(<WorldSurface />);
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
  mockFrameRequest = undefined;
  mockTerrainPoint = undefined;
  mockExposure = undefined;
  mockSnapGrid = undefined;
  mockSnapAngle = undefined;
  mockVobProps = { class: 'zCVob' };
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => { useWorldStore.getState().reset(); });

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
    act(() => useWorldStore.getState().selectVob(vob));
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

    act(() => useWorldStore.getState().selectVob(0));
    expect(screen.getByTestId('world-delete-vob')).toBeEnabled();

    act(() => useWorldStore.getState().toggleVob(1));
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

  it('asks for nothing at all for a class the catalogue does not have', async () => {
    // 35 of the 37 classes in a retail world, and a selection moves with every
    // click. An IPC round trip per click that can only answer "nothing to edit"
    // is a round trip for nothing.
    await openWorld();

    await waitFor(() => expect(api.getWorldVisuals).toHaveBeenCalled());
    expect(api.getVobProps).not.toHaveBeenCalled();
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
  // `tests/cameraNav.test.ts`; what is left to pin here is that the request
  // names the VOB that was double-clicked and that the selection follows it.
  it('asks the viewport for the double-clicked VOB, and selects it', async () => {
    // VOB 1 is selected by `openWorld`, so a request that merely repeated the
    // selection — or a tree that reported its row — would not say 0 here.
    await openWorld();
    expect(useWorldStore.getState().selection).toEqual([1]);

    fireEvent.doubleClick(screen.getByTestId('world-vob-row-0'));

    await waitFor(() => expect(mockFrameRequest).toEqual({ vob: 0 }));
    expect(useWorldStore.getState().selection).toEqual([0]);
  });

  it('is a fresh request every time, so the same VOB can be jumped to twice', async () => {
    // The viewport fires on the request's identity: a bare number would make
    // the second double-click on an already-framed VOB do nothing, which is
    // exactly when it is asked for — after the camera has wandered off.
    await openWorld();

    fireEvent.doubleClick(screen.getByTestId('world-vob-row-0'));
    await waitFor(() => expect(mockFrameRequest).toEqual({ vob: 0 }));
    const first = mockFrameRequest;

    fireEvent.doubleClick(screen.getByTestId('world-vob-row-0'));
    await waitFor(() => expect(mockFrameRequest).not.toBe(first));
    expect(mockFrameRequest).toEqual({ vob: 0 });
  });
});
