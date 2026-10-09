// First: the mock factories below read it, and the imports after it load them.
import * as mockViewportStub from './worldSurfaceViewportStub';
import { describe, it, expect } from '@jest/globals';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import {
  createVobReader, eulerDeltaRotation, eulerToZenRotation, placeBounds, type WorldOp, type ZenRotation,
} from 'zen-world';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { MOVE, SUMMARY, vobIndex } from './worldFixtures';
import { IDENTITY, TURN, mockFramePoint, mockRaycastDown, vp } from './worldSurfaceViewportStub';
import { api, coordinate, openWorld } from './worldSurfaceEditingHarness';

/**
 * The World surface's half of an edit — moving, turning and saving. Fixtures, the
 * viewport stub and `openWorld` are in `worldSurfaceEditingHarness.tsx`.
 */

jest.mock('react-virtualized-auto-sizer', () => mockViewportStub.autoSizerStub);
jest.mock('../src/renderer/components/world/WorldViewport', () => mockViewportStub.viewportStubModule());

describe('ground placement modes', () => {
  it('rests the model base or places the pivot at the hit, by button and shortcut', async () => {
    await openWorld(undefined, undefined, undefined, [-1, -30, -10, 1, 2, 10]);
    mockRaycastDown.mockReturnValue({ point: [10, 0, 30], normal: [0, 1, 0] });

    fireEvent.click(screen.getByTestId('world-rest-on-ground'));
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(api.applyWorldOps.mock.calls[0][0]).toMatchObject([{ op: 'MoveVob', vob: 1, to: [10, 30, 30] }]);

    fireEvent.keyDown(window, { key: 'G', shiftKey: true });
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(2));
    expect(api.applyWorldOps.mock.calls[1][0]).toMatchObject([{ op: 'MoveVob', vob: 1, to: [10, 0, 30] }]);

    fireEvent.keyDown(window, { key: 'g' });
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(3));
    expect(api.applyWorldOps.mock.calls[2][0]).toMatchObject([{ op: 'MoveVob', vob: 1, to: [10, 30, 30] }]);
  });
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

  it('says so when turning an overlay on cannot read the waynet', async () => {
    // The open path was rewritten to report this rather than throw the world
    // away (the 2026-08-29 review's first finding). These two toggles read the
    // same payload for the same reason and reported nothing at all: the button
    // stayed on, the overlay drew nothing, and no message said why.
    // The open's read fails first, which leaves `waynet` null — that path
    // already reports, and is not what this is about. Clearing the banner puts
    // the surface in the state a user is actually in: a world open, no waynet
    // read yet, and the toggle about to try again.
    api.getWorldWaynet.mockRejectedValueOnce(new Error('open read failed') as never);
    await openWorld();
    await waitFor(() => expect(screen.getByTestId('world-edit-error')).toBeInTheDocument());
    await act(async () => { useWorldStore.getState().editFailed(null); });

    api.getWorldWaynet.mockRejectedValueOnce(new Error('worker exited') as never);
    fireEvent.click(screen.getByTestId('world-waynet-toggle'));

    await waitFor(() => expect(screen.getByTestId('world-edit-error')).toHaveTextContent(/worker exited/));
  });

  it('does not carry the clipboard, or the last world\'s banners, into the next world', async () => {
    // The clipboard holds world-space positions from the world it was copied
    // in, so a paste into another world puts VOBs at coordinates nobody chose.
    // The banners are the same shape of leftover: "Saved to …" standing over a
    // world that was never saved.
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    await waitFor(() => expect(api.getVobProps).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('world-save'));
    fireEvent.click(await screen.findByTestId('world-save-confirm'));
    await screen.findByTestId('world-saved');

    const next = { ...SUMMARY, worldPath: 'C:/Gothic/OldWorld.zen', vobIndex: vobIndex([[0, 0, 0]]) };
    api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/OldWorld.zen' as never);
    api.openWorld.mockResolvedValueOnce(next as never);
    api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: next.bbox } as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
    fireEvent.click(screen.getByTestId('world-open'));
    fireEvent.click(await screen.findByTestId('world-picker-browse'));
    await waitFor(() => expect(useWorldStore.getState().summary).toBe(next));

    expect(screen.queryByTestId('world-saved')).not.toBeInTheDocument();

    // And a paste in the new world adds nothing, because there is nothing held.
    api.applyWorldOps.mockClear();
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
    await act(async () => { await Promise.resolve(); });
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  /**
   * #334: every open replaced the world and its unsaved edits with no word.
   * Only the routine flow asked first; the guard now stands in front of every
   * open, so the picker and the dialog editor's jump ask too.
   */
  describe('opening another world over unsaved edits', () => {
    const OTHER = { ...SUMMARY, worldPath: 'C:/Gothic/OldWorld.zen', vobIndex: vobIndex([[0, 0, 0]]) };
    const stubOtherOpen = () => {
      api.openWorld.mockResolvedValueOnce(OTHER as never);
      api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: OTHER.bbox } as never);
      api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
    };
    const editTheWorld = async () => {
      fireEvent.click(screen.getByTestId('stub-drag'));
      await waitFor(() => expect(useWorldStore.getState().hasUnsavedEdits).toBe(true));
    };
    const browseTo = async (worldPath: string) => {
      api.openWorldDialog.mockResolvedValueOnce(worldPath as never);
      fireEvent.click(screen.getByTestId('world-open'));
      fireEvent.click(await screen.findByTestId('world-picker-browse'));
    };

    it('asks before Browse… replaces the world, and Cancel keeps it, edits and all', async () => {
      const summary = await openWorld();
      await editTheWorld();
      api.openWorld.mockClear();

      await browseTo('C:/Gothic/OldWorld.zen');

      const confirm = await screen.findByRole('dialog', { name: 'Discard unsaved world edits?' });
      expect(confirm).toHaveTextContent('NewWorld.zen');
      expect(confirm).toHaveTextContent('OldWorld.zen');
      fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard unsaved world edits?' }))
        .not.toBeInTheDocument());
      expect(api.openWorld).not.toHaveBeenCalled();
      expect(useWorldStore.getState().summary).toBe(summary);
      expect(useWorldStore.getState().hasUnsavedEdits).toBe(true);
    });

    it('opens the world once the discard is confirmed', async () => {
      await openWorld();
      await editTheWorld();
      stubOtherOpen();

      await browseTo('C:/Gothic/OldWorld.zen');
      fireEvent.click(await screen.findByRole('button', { name: 'Discard and open OldWorld.zen' }));

      await waitFor(() => expect(useWorldStore.getState().summary).toBe(OTHER));
      expect(useWorldStore.getState().hasUnsavedEdits).toBe(false);
    });

    it('asks before a listed world replaces it too', async () => {
      await openWorld();
      await editTheWorld();
      api.openWorld.mockClear();
      api.listWorlds.mockResolvedValueOnce([
        { path: 'C:/Gothic/OldWorld.zen', name: 'OldWorld.zen', source: 'C:/Gothic', isDefault: false },
      ] as never);

      fireEvent.click(screen.getByTestId('world-open'));
      fireEvent.click(await screen.findByTestId('world-picker-entry-OldWorld.zen'));

      expect(await screen.findByRole('dialog', { name: 'Discard unsaved world edits?' })).toBeInTheDocument();
      expect(api.openWorld).not.toHaveBeenCalled();
    });

    it('asks before the dialog editor\'s jump opens another world, and a Cancel makes no jump', async () => {
      const summary = await openWorld();
      await editTheWorld();
      api.openWorld.mockClear();
      api.listWorlds.mockResolvedValueOnce([
        { path: 'C:/Gothic/OldWorld.zen', name: 'OldWorld.zen', source: 'C:/Gothic', isDefault: false },
      ] as never);

      await act(async () => {
        useWorldStore.getState().requestFocus({ kind: 'waypoint', name: 'wp_middle', inWorld: 'OLDWORLD' });
      });

      const confirm = await screen.findByRole('dialog', { name: 'Discard unsaved world edits?' });
      fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard unsaved world edits?' }))
        .not.toBeInTheDocument());
      expect(api.openWorld).not.toHaveBeenCalled();
      expect(useWorldStore.getState().summary).toBe(summary);
      expect(mockFramePoint).not.toHaveBeenCalled();
    });

    it('does not ask when there is nothing to lose', async () => {
      await openWorld();
      stubOtherOpen();

      await browseTo('C:/Gothic/OldWorld.zen');

      await waitFor(() => expect(useWorldStore.getState().summary).toBe(OTHER));
      expect(screen.queryByRole('dialog', { name: 'Discard unsaved world edits?' })).not.toBeInTheDocument();
    });
  });

  it('says so when an undo is refused, instead of failing silently', async () => {
    // Both callers are `void runHistory(...)`, so a rejected undo — a dead
    // worker, a refused replay — was an unhandled rejection: no banner, the
    // buttons left at a depth the main process no longer agrees with, and a
    // view quietly one edit behind the world.
    await openWorld();
    api.undoWorldEdit.mockRejectedValueOnce(new Error('the world worker died') as never);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => expect(screen.getByTestId('world-edit-error'))
      .toHaveTextContent(/undo did not go through.*worker died/i));
  });

  it('marks the world edited until it is saved, and says so on the Save button', async () => {
    // `unsavedEdits` existed only to block the quick test. Nothing on screen
    // said a world had been edited: no marker on Save, nothing in the stats, no
    // title change — so "have I saved this?" was a question the app would not
    // answer, over files that are somebody's retail install.
    await openWorld();
    expect(screen.getByTestId('world-save')).toHaveAccessibleName('Save world');

    fireEvent.click(screen.getByTestId('stub-drag'));
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());

    // An icon button now: the state is its accessible name and its dot.
    await waitFor(() => expect(screen.getByTestId('world-save')).toHaveAccessibleName(/edited/i));
  });

  it('saves on Ctrl+S, the same confirm the button opens', async () => {
    await openWorld();

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(await screen.findByTestId('world-save-confirm')).toBeInTheDocument();
  });

  it('saves as from the button, with no overwrite warning, and follows the new file (#367)', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('stub-drag'));
    await waitFor(() => expect(screen.getByTestId('world-save')).toHaveAccessibleName(/edited/i));

    fireEvent.click(screen.getByTestId('world-save-as'));

    await waitFor(() => expect(api.saveWorldAs).toHaveBeenCalledWith());
    // The dialog is the native one's: nothing here asks before overwriting.
    expect(screen.queryByTestId('world-save-confirm')).not.toBeInTheDocument();
    expect(api.saveWorld).not.toHaveBeenCalled();
    expect(await screen.findByTestId('world-saved')).toHaveTextContent('C:/Gothic/Copy.zen');
    // Written, so no longer edited; and the surface now means the new file.
    await waitFor(() => expect(screen.getByTestId('world-save')).toHaveAccessibleName('Save world'));
    expect(useWorldStore.getState().summary?.worldPath).toBe('C:/Gothic/Copy.zen');
  });

  it('saves as on Ctrl+Shift+S (#367)', async () => {
    await openWorld();

    fireEvent.keyDown(window, { key: 'S', ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(api.saveWorldAs).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('world-save-confirm')).not.toBeInTheDocument();
  });

  it('a cancelled save as changes nothing (#367)', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('stub-drag'));
    await waitFor(() => expect(screen.getByTestId('world-save')).toHaveAccessibleName(/edited/i));
    api.saveWorldAs.mockResolvedValueOnce(null);

    fireEvent.click(screen.getByTestId('world-save-as'));

    await waitFor(() => expect(api.saveWorldAs).toHaveBeenCalled());
    expect(screen.queryByTestId('world-saved')).not.toBeInTheDocument();
    expect(screen.getByTestId('world-save')).toHaveAccessibleName(/edited/i);
    expect(useWorldStore.getState().summary?.worldPath).toBe('C:/Gothic/NewWorld.zen');
  });

  it('shows a refused save as without tearing the world down (#367)', async () => {
    await openWorld();
    api.saveWorldAs.mockRejectedValueOnce(new Error("refusing to save a world loaded from a 'binary' archive"));

    fireEvent.click(screen.getByTestId('world-save-as'));

    expect(await screen.findByTestId('world-save-error')).toHaveTextContent(/binary/i);
    expect(screen.getByTestId('world-viewport-stub')).toBeInTheDocument();
  });

  it('lets the saved banner be dismissed', async () => {
    // It stood until the *next* save started — across every later edit, still
    // claiming a world was saved while the Save button said it was edited.
    await openWorld();
    fireEvent.click(screen.getByTestId('world-save'));
    fireEvent.click(await screen.findByTestId('world-save-confirm'));
    const banner = await screen.findByTestId('world-saved');
    // The confirm's own Modal marks the rest of the app `aria-hidden` while it
    // is up, so the banner behind it has no accessible role until it is gone.
    await waitFor(() => expect(screen.queryByTestId('world-save-confirm')).not.toBeInTheDocument());

    fireEvent.click(within(banner).getByRole('button', { name: /close/i }));

    await waitFor(() => expect(screen.queryByTestId('world-saved')).not.toBeInTheDocument());
  });

  it('does not apply an edit that was still in flight when the next world opened', async () => {
    // The main process records the batch against the world it edited, and drops
    // it when that world is no longer the one open (`WorldService.generation`).
    // This side has the same window and the same duty: `applied` writes into the
    // columns of whatever summary the store now holds, and would have written
    // A's move into B's index, marked B edited — blocking its quick test — and
    // handed the viewport A's ops to draw.
    await openWorld();
    let take = (): void => undefined;
    api.applyWorldOps.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      take = () => resolve(undefined);
    }));

    fireEvent.click(screen.getByTestId('stub-drag'));
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());

    // The next world, opened while that commit is still out.
    const next = {
      ...SUMMARY,
      worldPath: 'C:/Gothic/OldWorld.zen',
      vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]),
    };
    api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/OldWorld.zen' as never);
    api.openWorld.mockResolvedValueOnce(next as never);
    api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: next.bbox } as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
    fireEvent.click(screen.getByTestId('world-open'));
    fireEvent.click(await screen.findByTestId('world-picker-browse'));
    await waitFor(() => expect(useWorldStore.getState().summary).toBe(next));

    await act(async () => { take(); });

    // B's VOB 1 is where B says it is, and nothing was drawn over it.
    expect(createVobReader(next.vobIndex).position(1)).toEqual([10, 20, 30]);
    expect(vp.appliedOps).toBeNull();
  });

  it('sends the VOB back where it was when the op is refused, and says so', async () => {
    // The viewport has already drawn the drag. Left alone, the VOB sits at a
    // position nothing in the world agrees with — including the property grid
    // right next to it.
    const summary = await openWorld();
    api.applyWorldOps.mockRejectedValueOnce(new Error('no vob at indexPath'));

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(vp.appliedOps).toEqual([{ ...MOVE, from: MOVE.to, to: MOVE.from }]));
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

    await waitFor(() => expect(vp.appliedOps).toEqual([MOVE]));
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

    await waitFor(() => expect(vp.appliedOps).toHaveLength(2));
    expect(vp.appliedOps).toEqual([
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

    await waitFor(() => expect(vp.selection).toEqual([1, 0]));
  });

  it('does nothing at all with nothing selected', async () => {
    // The gizmo is detached then, but the drag hook is reachable from the
    // driver script and an empty batch is an undo entry that undoes nothing.
    await openWorld();
    act(() => useWorldStore.getState().selectVob(null));

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(vp.selection).toEqual([]));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });
});

// #292: ZenGin positions are world-space, so a parent moved alone left its
// children standing where they were.
describe('a drag or a turn of a parent', () => {
  it('moves the children with it, in the same one batch', async () => {
    await openWorld(undefined, [-1, 0]);
    act(() => useWorldStore.getState().selectVob(0));

    fireEvent.click(screen.getByTestId('stub-drag'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const [[ops]] = api.applyWorldOps.mock.calls as unknown as [[WorldOp[]]];
    expect(ops.map((op) => [op.op, (op as { path: string }).path, (op as { to: unknown }).to])).toEqual([
      ['MoveVob', '0', [1, 2, 3]],
      ['MoveVob', '0/0', [11, 22, 33]],
    ]);
  });

  it('turns the children with it, round the parent’s origin', async () => {
    await openWorld(undefined, [-1, 0]);
    act(() => useWorldStore.getState().selectVob(0));

    fireEvent.click(screen.getByTestId('stub-turn'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const [[ops]] = api.applyWorldOps.mock.calls as unknown as [[WorldOp[]]];
    expect(ops.map((op) => [op.op, (op as { path: string }).path])).toEqual([
      ['RotateVob', '0'], ['RotateVob', '0/0'], ['MoveVob', '0/0'],
    ]);
    // The child at [10, 20, 30], a quarter turn about Y round the parent at
    // the origin: +Z goes to +X and +X to -Z.
    expect((ops[2] as { to: number[] }).to).toEqual([30, 20, -10]);
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

    await waitFor(() => expect(vp.appliedOps).not.toBeNull());
    expect(vp.appliedOps).toEqual([{
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
    expect(vp.gizmoMode).toBe('translate');

    fireEvent.keyDown(window, { key: 'e' });
    await waitFor(() => expect(vp.gizmoMode).toBe('rotate'));

    // W nudges a selected VOB forward; only without a selection is it the
    // translate-gizmo shortcut.
    act(() => useWorldStore.getState().selectVob(null));
    fireEvent.keyDown(window, { key: 'w' });
    await waitFor(() => expect(vp.gizmoMode).toBe('translate'));

    fireEvent.click(screen.getByTestId('world-gizmo-rotate'));
    await waitFor(() => expect(vp.gizmoMode).toBe('rotate'));
  });

  it('leaves the gizmo alone when the letter was typed into a field', async () => {
    // Bare letters, on a *window* listener: the app is full of text fields and
    // an 'e' typed into one must not silently change what the gizmo does.
    await openWorld();
    const field = document.createElement('input');
    document.body.appendChild(field);

    fireEvent.keyDown(field, { key: 'e' });

    expect(vp.gizmoMode).toBe('translate');
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
    expect(vp.exposure).toBe(1);

    fireEvent.change(screen.getByLabelText('Brightness'), { target: { value: '2.5' } });

    await waitFor(() => expect(vp.exposure).toBe(2.5));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
    expect(vp.appliedOps ?? null).toBeNull();
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
    expect(vp.hiddenVobs ?? null).toBeNull();

    await toggleClass('zCVobLight');

    await waitFor(() => expect([...(vp.hiddenVobs ?? [])]).toEqual([1, 0]));
    // A view setting: no op, nothing dirtied, nothing saved.
    expect(api.applyWorldOps).not.toHaveBeenCalled();
    expect(vp.appliedOps ?? null).toBeNull();
  });

  it('shows the class again when it is toggled off', async () => {
    await openWorld(['zCVobLight', 'zCVob']);

    await toggleClass('zCVobLight');
    await waitFor(() => expect([...(vp.hiddenVobs ?? [])]).toEqual([1, 0]));
    await toggleClass('zCVobLight');

    await waitFor(() => expect(vp.hiddenVobs ?? null).toBeNull());
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
    expect(vp.snapGrid).toBe(0);

    await chooseStep('1 m');

    // ZenGin centimetres, which is what every position in this app is in.
    await waitFor(() => expect(vp.snapGrid).toBe(100));
    // A view setting like the brightness: it changes how an edit is made and is
    // not itself an edit.
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('offers angles in the turn mode and keeps both steps', async () => {
    await openWorld();
    await chooseStep('50 cm');
    await waitFor(() => expect(vp.snapGrid).toBe(50));

    fireEvent.click(screen.getByTestId('world-gizmo-rotate'));
    // The control follows the mode: a distance is meaningless for a turn, so
    // what it offers now is angles — and the angle step starts free.
    await waitFor(() => expect(vp.gizmoMode).toBe('rotate'));
    expect(vp.snapAngle).toBe(0);

    await chooseStep('45°');
    // Degrees on the bar, radians on the wire — the gizmo turns in radians.
    await waitFor(() => expect(vp.snapAngle).toBeCloseTo(Math.PI / 4, 10));

    // And the move step survived the detour: switching back must not have
    // reset the step the other mode was set to.
    fireEvent.click(screen.getByTestId('world-gizmo-translate'));
    await waitFor(() => expect(vp.gizmoMode).toBe('translate'));
    expect(vp.snapGrid).toBe(50);
    expect(vp.snapAngle).toBeCloseTo(Math.PI / 4, 10);
  });
});

describe('saving the world', () => {
  const openSaveDialog = async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-save'));
    await screen.findByTestId('world-save-confirm');
  };

  it('warns before it overwrites the opened file, not after it has written', async () => {
    // Both warnings are facts about ZenGin rather than about this editor, and
    // both are about whether to save at all: the lighting a world was compiled
    // with is not re-baked by an edit, and a savegame carries its own copy of
    // the VOB tree.
    await openSaveDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/lighting/i);
    expect(dialog).toHaveTextContent(/savegame/i);
    expect(dialog).toHaveTextContent('C:/Gothic/NewWorld.zen');
  });

  it('writes nothing when the warning is dismissed', async () => {
    await openSaveDialog();

    fireEvent.click(screen.getByTestId('world-save-cancel'));

    await waitFor(() => expect(screen.queryByTestId('world-save-confirm')).not.toBeInTheDocument());
    expect(api.saveWorld).not.toHaveBeenCalled();
  });

  it('overwrites the opened file without opening a Save As dialog', async () => {
    await openSaveDialog();

    fireEvent.click(screen.getByTestId('world-save-confirm'));

    await waitFor(() => expect(api.saveWorld).toHaveBeenCalledWith());
    expect(await screen.findByTestId('world-saved')).toHaveTextContent('C:/Gothic/NewWorld.zen');
  });

  it('shows the binding\'s refusal without tearing the world down', async () => {
    // A non-BinSafe world is the case this is for, and the sentence the binding
    // writes is the only one the user can act on.
    await openSaveDialog();
    api.saveWorld.mockRejectedValueOnce(
      new Error("refusing to save a world loaded from a 'binary' archive"),
    );

    fireEvent.click(screen.getByTestId('world-save-confirm'));

    expect(await screen.findByTestId('world-save-error')).toHaveTextContent(/binary/i);
    expect(screen.getByTestId('world-viewport-stub')).toBeInTheDocument();
  });
});
