import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createVobReader, type VobIndex, type WorldOp } from 'zen-world';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import type { WorldSummary } from '../src/shared/worldTypes';

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
/** A quarter turn about Y, row-major — asymmetric, so a transpose would show. */
const TURN: number[] = [0, 0, 1, 0, 1, 0, -1, 0, 0];
jest.mock('../src/renderer/components/world/WorldViewport', () => ({
  __esModule: true,
  default: (props: {
    onTranslateSelection: (delta: [number, number, number]) => void;
    onRotateSelection: (delta: number[]) => void;
    gizmoMode: string;
    selection: readonly number[];
    appliedOps: WorldOp[] | null;
  }) => {
    mockAppliedOps = props.appliedOps;
    mockSelection = props.selection;
    mockGizmoMode = props.gizmoMode;
    return (
      <>
        <button type="button" data-testid="stub-drag" onClick={() => props.onTranslateSelection(DRAG)}>
          drag
        </button>
        <button type="button" data-testid="stub-turn" onClick={() => props.onRotateSelection(TURN)}>
          turn
        </button>
      </>
    );
  },
}));

function vobIndex(positions: Array<[number, number, number]>): VobIndex {
  const count = positions.length;
  const columns = new Float32Array(count * 3);
  positions.forEach((position, i) => columns.set(position, i * 3));
  const childIndex = new Uint32Array(count);
  childIndex.forEach((_, i) => { childIndex[i] = i; });
  // Identity, not zeros: a zero matrix is not a rotation any world contains,
  // and a rotation op composed onto one produces a box collapsed to a point.
  const rotations = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) rotations.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);

  return {
    count,
    parent: new Int32Array(count).fill(-1).buffer,
    childIndex: childIndex.buffer,
    positions: columns.buffer,
    rotations: rotations.buffer,
    flags: new Uint32Array(count).buffer,
    classes: ['zCVob'], classIndex: new Uint32Array(count).buffer,
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

const MOVE: WorldOp = {
  op: 'MoveVob', vob: 1, path: '1', from: [10, 20, 30], to: [11, 22, 33],
};

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
  applyWorldOps: jest.fn(async () => undefined),
  undoWorldEdit: jest.fn(async (): Promise<WorldOp[] | null> => null),
  redoWorldEdit: jest.fn(async (): Promise<WorldOp[] | null> => null),
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
async function openWorld() {
  const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]) };
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
  act(() => useWorldStore.getState().selectVob(1));
  return summary;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAppliedOps = undefined;
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
    expect(screen.getByTestId('world-prop-position')).toHaveTextContent('10, 20, 30');

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(screen.getByTestId('world-prop-position')).toHaveTextContent('11, 22, 33'));
  });

  it('hands the applied ops to the viewport, so the scene follows the index', async () => {
    await openWorld();

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(mockAppliedOps).toEqual([MOVE]));
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
