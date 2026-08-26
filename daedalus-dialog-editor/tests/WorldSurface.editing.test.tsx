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
jest.mock('../src/renderer/components/world/WorldViewport', () => ({
  __esModule: true,
  default: (props: {
    onMoveVob: (vob: number, to: [number, number, number]) => void;
    appliedOps: WorldOp[] | null;
  }) => {
    mockAppliedOps = props.appliedOps;
    return (
      <button type="button" data-testid="stub-drag" onClick={() => props.onMoveVob(1, [11, 22, 33])}>
        drag
      </button>
    );
  },
}));

function vobIndex(positions: Array<[number, number, number]>): VobIndex {
  const count = positions.length;
  const columns = new Float32Array(count * 3);
  positions.forEach((position, i) => columns.set(position, i * 3));
  const childIndex = new Uint32Array(count);
  childIndex.forEach((_, i) => { childIndex[i] = i; });

  return {
    count,
    parent: new Int32Array(count).fill(-1).buffer,
    childIndex: childIndex.buffer,
    positions: columns.buffer,
    rotations: new Float32Array(count * 9).buffer,
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
 */
async function openWorld() {
  const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]) };
  api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
  api.openWorld.mockResolvedValueOnce(summary as never);
  api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
  api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 1 } } as never);

  render(<WorldSurface />);
  fireEvent.click(screen.getByTestId('world-open'));
  await screen.findByTestId('stub-drag');
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
