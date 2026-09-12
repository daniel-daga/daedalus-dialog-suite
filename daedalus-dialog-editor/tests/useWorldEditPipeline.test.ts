/**
 * The World surface's edit pipeline, lifted out of `WorldSurface.tsx` — the last
 * of the nine concerns `docs/plans/level-editor-review-2026-09-04.md` §4 named,
 * and the one that had to go last because it is where the in-flight guard (§2.7)
 * and the refusal path live.
 *
 * Three rules here are the ones the rest of the surface is built on top of, and
 * each of them was a bug once:
 *
 *   - **Before the commit point a failure is a refusal; past it, it is a stale
 *     view** (§2.7's commentary). A refusal puts the screen back and returns
 *     false. A failure inside `applied` does neither — the world holds the edit,
 *     and pretending otherwise had three layers disagreeing about it.
 *   - **One commit at a time** (§2.7). Every builder reads `from` out of a
 *     projection that is only written when the round trip is back, so two
 *     overlapping commits build two ops from the same `from`.
 *   - **A round trip that comes back into a different world is dropped**
 *     (§2.4), on the commit path and the history path alike.
 *
 * Through the surface each of those needs a mounted viewport, a real store and
 * an interleaving. Here they are a function call.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import type { WorldOp } from 'zen-world';
import { useWorldEditPipeline } from '../src/renderer/components/world/hooks/useWorldEditPipeline';
import { useWorldStore } from '../src/renderer/store/worldStore';
import {
  SUMMARY, MOVE, WAYPOINT_MOVE, WAYPOINT_WAS, WAYPOINT_TO,
  makeWorldEditorApi, vobIndex, waynetPayload,
} from './worldFixtures';

const api = makeWorldEditorApi();

const surface = {
  setWaynet: jest.fn(),
  setVisuals: jest.fn(),
  setAppliedOps: jest.fn(),
  markEdited: jest.fn(),
  forgetClassProps: jest.fn(),
  refreshHistoryDepth: jest.fn(),
};

/** The generation `openWorldAt` bumps. Kept out here so a test can open a world
 *  under a commit that is still out. */
let openGeneration: { current: number };

function mount(waynet = waynetPayload()) {
  openGeneration = { current: 0 };
  return renderHook(() => useWorldEditPipeline({
    waynet, ...surface, openGeneration,
  } as never));
}

/** Ops whose classification the pipeline branches on. */
const APPEND_ROOT: WorldOp = {
  op: 'AddVob', vob: 2, path: '2', parentPath: null, from: null, to: { name: 'NEW' },
} as unknown as WorldOp;
const ADD_UNDER_PARENT: WorldOp = {
  op: 'AddVob', vob: 2, path: '0/0', parentPath: '0', from: null, to: { name: 'NEW' },
} as unknown as WorldOp;
const DELETE_VOB: WorldOp = { op: 'DeleteVob', vob: 1, path: '1' } as unknown as WorldOp;
const SWAP_VISUAL: WorldOp = {
  op: 'SetVobProp', vob: 1, path: '1', from: { visual: 'OLD.3DS' }, to: { visual: 'NEW.3DS' },
} as unknown as WorldOp;
const RENAME_WAYPOINT: WorldOp = {
  op: 'RenameWaypoint', waypoint: 1, from: 'WP_MIDDLE', to: 'WP_RENAMED',
} as unknown as WorldOp;
const ADD_WAYPOINT: WorldOp = {
  op: 'AddWaypoint', waypoint: 3, from: null, to: { name: 'WP_NEW', position: [0, 0, 0] },
} as unknown as WorldOp;
/** An add with its sides swapped, which is what an undone add arrives as. */
const REMOVE_WAYPOINT: WorldOp = {
  op: 'AddWaypoint', waypoint: 3, from: { name: 'WP_NEW', position: [0, 0, 0] }, to: null,
} as unknown as WorldOp;

beforeEach(() => {
  jest.clearAllMocks();
  // Re-stubbed rather than merely cleared: `clearAllMocks` forgets the calls but
  // keeps the implementation, so a `mockRejectedValue` in one block's own
  // `beforeEach` would otherwise refuse every commit in every block after it.
  api.applyWorldOps.mockResolvedValue(undefined as never);
  api.undoWorldEdit.mockResolvedValue(null as never);
  api.redoWorldEdit.mockResolvedValue(null as never);
  api.refreshWorldIndex.mockResolvedValue({ ...vobIndex([[0, 0, 0]]) } as never);
  api.getWorldVisuals.mockResolvedValue({ visuals: [], stats: { vobsPlaced: 0 } } as never);
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
  useWorldStore.setState({
    summary: { ...SUMMARY, vobIndex: vobIndex([[10, 20, 30], [10, 20, 30]]) },
    selection: [1],
    selectedWaypoint: null,
    editError: null,
  } as never);
});

describe('useWorldEditPipeline — the one door an edit goes through', () => {
  test('a committed batch is sent, then the view catches up with it', async () => {
    const { result } = mount();
    await act(async () => { expect(await result.current.commitOps([MOVE])).toBe(true); });

    expect(api.applyWorldOps).toHaveBeenCalledWith([MOVE]);
    expect(surface.markEdited).toHaveBeenCalled();
    expect(surface.setAppliedOps).toHaveBeenCalledWith([MOVE]);
    expect(surface.refreshHistoryDepth).toHaveBeenCalled();
  });

  test('a non-structural batch asks the main process for nothing more', async () => {
    const { result } = mount();
    await act(async () => { await result.current.commitOps([MOVE]); });
    expect(api.refreshWorldIndex).not.toHaveBeenCalled();
    expect(surface.setVisuals).not.toHaveBeenCalled();
  });

  test('a structural batch re-reads the index whole and the visuals with it', async () => {
    // A flat index is a position in a depth-first traversal, so it cannot be
    // patched; an instance cannot be appended to an allocated `InstancedMesh`.
    const { result } = mount();
    await act(async () => { await result.current.commitOps([APPEND_ROOT]); });
    expect(api.refreshWorldIndex).toHaveBeenCalled();
    expect(surface.setVisuals).toHaveBeenCalled();
  });

  test('a swapped visual re-reads the visuals without being structural', async () => {
    // A different mesh lives in a different `InstancedMesh`, which may not exist
    // yet — but no VOB came or went and nothing renumbered.
    const { result } = mount();
    await act(async () => { await result.current.commitOps([SWAP_VISUAL]); });
    expect(surface.setVisuals).toHaveBeenCalled();
    expect(api.refreshWorldIndex).not.toHaveBeenCalled();
  });
});

describe('useWorldEditPipeline — what a renumbering op costs the selection', () => {
  test('a delete clears it: the other VOBs in a multi-select are unrecoverable', async () => {
    const { result } = mount();
    await act(async () => { await result.current.commitOps([DELETE_VOB]); });
    expect(useWorldStore.getState().selection).toEqual([]);
  });

  test('an add under a parent renumbers everything after that subtree', async () => {
    const { result } = mount();
    await act(async () => { await result.current.commitOps([ADD_UNDER_PARENT]); });
    expect(useWorldStore.getState().selection).toEqual([]);
  });

  test('an appended root shifts nothing, so the selection stands', async () => {
    const { result } = mount();
    await act(async () => { await result.current.commitOps([APPEND_ROOT]); });
    expect(useWorldStore.getState().selection).toEqual([1]);
  });
});

describe('useWorldEditPipeline — a refusal, which is before the commit point', () => {
  beforeEach(() => { api.applyWorldOps.mockRejectedValue(new Error('the binding refused it')); });

  test('says so, puts the screen back, and answers false', async () => {
    const { result } = mount();
    await act(async () => { expect(await result.current.commitOps([MOVE])).toBe(false); });

    expect(useWorldStore.getState().editError).toContain('the binding refused it');
    expect(surface.forgetClassProps).toHaveBeenCalled();
    expect(result.current.editRefusals).toBe(1);
    // Nothing was applied: the world does not hold the edit.
    expect(surface.markEdited).not.toHaveBeenCalled();
  });

  test('the viewport is handed the inverse, because it already drew the drag', async () => {
    const { result } = mount();
    await act(async () => { await result.current.commitOps([MOVE]); });

    const [reverted] = surface.setAppliedOps.mock.calls[0] as [WorldOp[]];
    // `invertOp` rather than a swap of `from` and `to` here: a rotation carries
    // a box for each pose, and swapping only the matrix is half an inverse.
    expect(reverted).toHaveLength(1);
    expect(reverted[0]).toMatchObject({ op: 'MoveVob', from: MOVE.to, to: MOVE.from });
  });

  test('a barrier op is dropped from the revert rather than inverted', async () => {
    // What the revert puts back is the viewport's *optimistic* draw of a gizmo
    // drag, and a delete is never drawn before the main process has taken it —
    // so asking `invertOp` for one would throw where nothing needs an inverse.
    const { result } = mount();
    await act(async () => { await result.current.commitOps([DELETE_VOB]); });
    expect(surface.setAppliedOps).toHaveBeenCalledWith([]);
  });
});

describe('useWorldEditPipeline — a failure past the commit point is a stale view', () => {
  test('the world holds the edit, so it answers true and says the view is behind', async () => {
    api.refreshWorldIndex.mockRejectedValue(new Error('the worker died'));
    const { result } = mount();
    await act(async () => { expect(await result.current.commitOps([APPEND_ROOT])).toBe(true); });

    expect(useWorldStore.getState().editError).toContain('could not be brought up to date');
    expect(useWorldStore.getState().editError).toContain('Re-open the world');
  });

  test('and nothing is put back — the three layers must not disagree about it', async () => {
    // Reported as a refusal, this said the edit did not happen while the columns
    // stayed written and the main process went on holding the op.
    api.refreshWorldIndex.mockRejectedValue(new Error('the worker died'));
    const { result } = mount();
    await act(async () => { await result.current.commitOps([APPEND_ROOT]); });

    expect(surface.forgetClassProps).not.toHaveBeenCalled();
    expect(result.current.editRefusals).toBe(0);
    expect(surface.markEdited).toHaveBeenCalled();
  });
});

describe('useWorldEditPipeline — one commit at a time', () => {
  /** A commit that hangs until it is let go. */
  function held() {
    let release: () => void = () => undefined;
    api.applyWorldOps.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    }));
    return () => release();
  }

  test('a second commit while one is out sends nothing and answers false', async () => {
    const release = held();
    const { result } = mount();

    let second: boolean | undefined;
    await act(async () => {
      const first = result.current.commitOps([MOVE]);
      second = await result.current.commitOps([MOVE]);
      release();
      await first;
    });

    expect(second).toBe(false);
    expect(api.applyWorldOps).toHaveBeenCalledTimes(1);
  });

  test('the dropped one still puts the screen back, silently', async () => {
    // This is auto-repeat and double-clicks, so a banner per dropped press
    // would be noise about nothing the user did wrong — but the viewport may
    // already have drawn the gizmo drag that got here.
    const release = held();
    const { result } = mount();

    await act(async () => {
      const first = result.current.commitOps([MOVE]);
      await result.current.commitOps([MOVE]);
      release();
      await first;
    });

    expect(surface.setAppliedOps).toHaveBeenCalledWith([
      expect.objectContaining({ op: 'MoveVob', from: MOVE.to, to: MOVE.from }),
    ]);
    expect(useWorldStore.getState().editError).toBeNull();
  });

  test('the guard clears even when the commit refused, rather than wedging the app', async () => {
    // `sendOps` has three exits, and one of them forgetting to clear the flag
    // would wedge every edit in the app for the rest of the session.
    api.applyWorldOps.mockRejectedValueOnce(new Error('refused'));
    const { result } = mount();
    await act(async () => { await result.current.commitOps([MOVE]); });

    await act(async () => { expect(await result.current.commitOps([MOVE])).toBe(true); });
    expect(api.applyWorldOps).toHaveBeenCalledTimes(2);
  });
});

describe('useWorldEditPipeline — a round trip into a different world', () => {
  test('the commit is forgotten rather than applied to the world now on screen', async () => {
    let release: () => void = () => undefined;
    api.applyWorldOps.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    }));
    const { result } = mount();

    await act(async () => {
      const out = result.current.commitOps([APPEND_ROOT]);
      // `openWorldAt` bumps the generation while the commit is out.
      openGeneration.current += 1;
      release();
      // True: the edit landed. In the world that is no longer showing.
      expect(await out).toBe(true);
    });

    expect(surface.markEdited).not.toHaveBeenCalled();
    expect(api.refreshWorldIndex).not.toHaveBeenCalled();
  });
});

describe('useWorldEditPipeline — undo and redo do not come through the commit', () => {
  test('the main process is asked what it did, and exactly that is applied', async () => {
    api.undoWorldEdit.mockResolvedValueOnce([MOVE] as never);
    const { result } = mount();
    await act(async () => { await result.current.runHistory('undo'); });

    expect(api.applyWorldOps).not.toHaveBeenCalled();
    expect(surface.setAppliedOps).toHaveBeenCalledWith([MOVE]);
    expect(surface.markEdited).toHaveBeenCalled();
  });

  test('a redo goes to the other call', async () => {
    api.redoWorldEdit.mockResolvedValueOnce([MOVE] as never);
    const { result } = mount();
    await act(async () => { await result.current.runHistory('redo'); });
    expect(api.redoWorldEdit).toHaveBeenCalled();
    expect(surface.setAppliedOps).toHaveBeenCalledWith([MOVE]);
  });

  test('an undone edit still marks the world edited, not clean', async () => {
    // An undone edit is a world whose bytes on disk are not what is on screen,
    // and the history's own depth cannot say otherwise.
    api.undoWorldEdit.mockResolvedValueOnce([MOVE] as never);
    const { result } = mount();
    await act(async () => { await result.current.runHistory('undo'); });
    expect(surface.markEdited).toHaveBeenCalled();
  });

  test('an empty stack is nothing to apply', async () => {
    api.undoWorldEdit.mockResolvedValueOnce([] as never);
    const { result } = mount();
    await act(async () => { await result.current.runHistory('undo'); });
    expect(surface.setAppliedOps).not.toHaveBeenCalled();
  });

  test('a rejection gets a banner naming the direction, and refreshes the depth', async () => {
    // Every caller is `void runHistory(...)`, so a rejection here had nowhere
    // to go: no banner, a stale depth on the buttons, a view behind the world.
    api.undoWorldEdit.mockRejectedValueOnce(new Error('the stack is gone'));
    const { result } = mount();
    await act(async () => { await result.current.runHistory('undo'); });

    expect(useWorldStore.getState().editError).toContain('The undo did not go through');
    expect(useWorldStore.getState().editError).toContain('the stack is gone');
    expect(surface.refreshHistoryDepth).toHaveBeenCalled();
  });

  test('a world opened while it was out drops it', async () => {
    api.undoWorldEdit.mockImplementationOnce(async () => {
      openGeneration.current += 1;
      return [MOVE] as never;
    });
    const { result } = mount();
    await act(async () => { await result.current.runHistory('undo'); });
    expect(surface.setAppliedOps).not.toHaveBeenCalled();
  });
});

describe('useWorldEditPipeline — the waynet half of the projection', () => {
  test('a move is written into the buffer the overlay is drawing through', async () => {
    // `applyEdit` writes the VOB columns and filters waypoint ops out, so this
    // is the only place a committed waypoint move reaches the renderer — and the
    // payload's position attribute is a *view* over this buffer.
    const payload = waynetPayload();
    const { result } = mount(payload);
    await act(async () => { await result.current.commitOps([WAYPOINT_MOVE]); });

    const positions = new Float32Array(payload.positions);
    expect([...positions.slice(3, 6)]).toEqual(WAYPOINT_TO);
    expect([...positions.slice(3, 6)]).not.toEqual(WAYPOINT_WAS);
  });

  test('a rename replaces the names and keeps the same positions buffer', async () => {
    // Nothing draws a name and the panel that shows one is React, so the list is
    // replaced rather than mutated.
    const payload = waynetPayload();
    const { result } = mount(payload);
    await act(async () => { await result.current.commitOps([RENAME_WAYPOINT]); });

    const [next] = surface.setWaynet.mock.calls[0] as [{ names: string[]; positions: ArrayBuffer }];
    expect(next.names).toContain('WP_RENAMED');
    expect(next.positions).toBe(payload.positions);
    expect(payload.names).toContain('WP_MIDDLE');
  });

  test('an append re-reads the payload whole — a typed array cannot grow', async () => {
    const { result } = mount();
    await act(async () => { await result.current.commitOps([ADD_WAYPOINT]); });
    expect(api.getWorldWaynet).toHaveBeenCalled();
  });

  test('a removing direction clears the selected waypoint before the re-read', async () => {
    // The tail goes away, and a gizmo standing on it would be standing on an
    // index the waynet no longer has.
    useWorldStore.setState({ selectedWaypoint: 3 } as never);
    const { result } = mount();
    await act(async () => { await result.current.commitOps([REMOVE_WAYPOINT]); });

    expect(useWorldStore.getState().selectedWaypoint).toBeNull();
    expect(api.getWorldWaynet).toHaveBeenCalled();
  });

  test('an append in the adding direction leaves the selected waypoint alone', async () => {
    useWorldStore.setState({ selectedWaypoint: 1 } as never);
    const { result } = mount();
    await act(async () => { await result.current.commitOps([ADD_WAYPOINT]); });
    expect(useWorldStore.getState().selectedWaypoint).toBe(1);
  });

  test('with the overlay never switched on there is no payload to patch', async () => {
    const { result } = mount(null as never);
    await act(async () => { expect(await result.current.commitOps([WAYPOINT_MOVE])).toBe(true); });
    expect(surface.setWaynet).not.toHaveBeenCalled();
  });
});
