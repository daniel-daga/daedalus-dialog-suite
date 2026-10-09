// First: the mock factories below read it, and the imports after it load them.
import * as mockViewportStub from './worldSurfaceViewportStub';
import { describe, it, expect } from '@jest/globals';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { placeBounds, PASTE_MIN_OFFSET, type WorldOp } from 'zen-world';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { SUMMARY, vobIndex } from './worldFixtures';
import { IDENTITY, mockFramePoint, mockFrameVob, vp } from './worldSurfaceViewportStub';
import { LIGHT_PROPS, api, coordinate, openWorld } from './worldSurfaceEditingHarness';

/**
 * The World surface's half of an edit — deleting, duplicating, copying and pasting. Fixtures, the
 * viewport stub and `openWorld` are in `worldSurfaceEditingHarness.tsx`.
 */

jest.mock('react-virtualized-auto-sizer', () => mockViewportStub.autoSizerStub);
jest.mock('../src/renderer/components/world/WorldViewport', () => mockViewportStub.viewportStubModule());

describe('deleting a VOB', () => {
  // The op §15 unblocked, and the half of it that is *not* the op. §15's
  // requirement in place of invertibility was that the user knows the history
  // goes before the delete lands; the delete has an inverse since 2026-09-14
  // (§7), so the confirm stays for the subtree instead.

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

  it('warns about the subtree, and says the delete undoes', async () => {
    // What replaced §15's "this clears your history", following the waypoint
    // dialog (§7). The claim it used to make is now false — the delete has
    // an inverse and the earlier edits survive it — and a dialog asserting that
    // would be worse than none. What is left is the part a user cannot see
    // coming from the selection on screen: everything *below* it goes too.
    await openWorld();

    await askToDelete(1);

    const warning = screen.getByTestId('world-delete-warning');
    expect(warning).toHaveTextContent(/scene tree|below it/i);
    expect(warning).toHaveTextContent(/ctrl\+z|undo/i);
    expect(warning).not.toHaveTextContent(/cannot be undone/i);
    expect(warning).not.toHaveTextContent(/history is cleared|undo history/i);
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

  it('is offered for a selection of any size, and for nothing selected never', async () => {
    // It used to be exactly one VOB, because a delete renumbers. #253 answered
    // that with the order rather than with a refusal: a batch applied back to
    // front leaves every path still to be used where it was resolved.
    await openWorld();

    act(() => useWorldStore.getState().selectVob(null));
    expect(screen.getByTestId('world-delete-vob')).toBeDisabled();

    // Awaited: every selection issues the per-VOB props read, and its answer
    // lands a microtask later — outside an `act` that has already returned.
    await act(async () => { useWorldStore.getState().selectVob(0); });
    expect(screen.getByTestId('world-delete-vob')).toBeEnabled();

    await act(async () => { useWorldStore.getState().toggleVob(1); });
    expect(screen.getByTestId('world-delete-vob')).toBeEnabled();
  });

  it('deletes the whole selection as one batch, back to front (#253)', async () => {
    // One batch, so one round trip and one undo entry — which since §7 means
    // an actual undo rather than one clearing of the history. Back to front,
    // because that is what makes the second path still valid after the first
    // VOB is gone.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(
      { ...summary, vobIndex: vobIndex([]) } as never,
    );
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    await act(async () => { useWorldStore.getState().selectVob(0); });
    await act(async () => { useWorldStore.getState().toggleVob(1); });
    fireEvent.click(await screen.findByTestId('world-delete-vob'));
    fireEvent.click(screen.getByTestId('world-delete-confirm'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(api.applyWorldOps).toHaveBeenCalledTimes(1);
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops).toEqual([
      { op: 'DeleteVob', vob: 1, path: '1' },
      { op: 'DeleteVob', vob: 0, path: '0' },
    ]);
  });

  it('says how many it is about to delete, so the warning is not about one VOB', async () => {
    await openWorld();

    await act(async () => { useWorldStore.getState().selectVob(0); });
    await act(async () => { useWorldStore.getState().toggleVob(1); });
    fireEvent.click(await screen.findByTestId('world-delete-vob'));

    expect(screen.getByTestId('world-delete-title')).toHaveTextContent(/2 VOBs/);
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

  it('ignores the second click of a double-click while the first is in flight', async () => {
    // §2.7 of `docs/plans/level-editor-review-2026-09-04.md`. Both clicks read
    // the same index, so the second built its `AddVob` against a world that
    // already had the first copy in it — same `path`, which the main process
    // then refused with an internal message. The guard drops it instead.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValue(summary as never);
    api.getWorldVisuals.mockResolvedValue(
      { visuals: [], stats: { vobsPlaced: 0 } } as never,
    );
    await act(async () => { useWorldStore.getState().selectVob(1); });
    let release: () => void = () => undefined;
    api.applyWorldOps.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = () => resolve(); }) as never,
    );
    const duplicate = await screen.findByTestId('world-duplicate-vob');

    fireEvent.click(duplicate);
    fireEvent.click(duplicate);
    await act(async () => undefined);

    expect(api.applyWorldOps).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
  });

  it('carries the class, so a duplicated light is a light', async () => {
    // D2's class half (level-editor.md §16.14). The class reaches the op
    // through the same spec every other field does — nothing new is fetched —
    // and it is the difference between a copy of a light and a `zCVob` wearing
    // its name, on which every `SetVobClassProp` would then be refused.
    vp.vobProps = LIGHT_PROPS;
    const summary = await openWorld(['zCVob', 'zCVobLight']);
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.click(await screen.findByTestId('world-duplicate-vob'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops[0]).toMatchObject({ op: 'AddVob', to: { class: 'zCVobLight' } });
  });

  it('carries the class properties, so a duplicated light keeps its range and colour', async () => {
    // D2's other half (§14.1 1.2). The class came across and the fields it names
    // did not, so a copy of a light was a light with the binding's range and the
    // binding's colour. They are in no column, so the surface fetches them —
    // the same `getVobProps` the property grid reads one VOB with — and hands
    // them to `duplicateVobs`, which follows each add with one
    // `SetVobClassProp` in the same batch. One batch, therefore one undo.
    vp.vobProps = LIGHT_PROPS;
    const summary = await openWorld(['zCVob', 'zCVobLight']);
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.click(await screen.findByTestId('world-duplicate-vob'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops).toHaveLength(2);
    expect(ops[1]).toEqual({
      op: 'SetVobClassProp',
      // The copy's own addresses — the VOB the add before it appends, which is
      // in no index this side could resolve a path against.
      vob: 2,
      path: '2',
      className: 'zCVobLight',
      // The catalogued fields of the read and nothing else: `presetName` and
      // `bias` are base fields, and a copy does not carry them.
      from: {
        lightType: 0, range: 2000, color: [255, 220, 180, 255], quality: 2,
      },
      to: {
        lightType: 0, range: 2000, color: [255, 220, 180, 255], quality: 2,
      },
    });
  });

  it('asks for no props at all when nothing in the copy has catalogued fields', async () => {
    // A read per VOB is a round trip per VOB, and most of a retail selection is
    // classes the catalogue is silent about. The plain `zCVob` fixture asks for
    // nothing beyond the selection read the grid already makes.
    await openWorld();
    api.getVobProps.mockClear();
    // Counted *at the commit*, because the grid re-reads the selection's own
    // props once the batch has applied — the read this is about is the one
    // issued before it, to build the ops.
    let readsBeforeCommit = -1;
    api.applyWorldOps.mockImplementationOnce(async () => {
      readsBeforeCommit = api.getVobProps.mock.calls.length;
    });

    fireEvent.click(await screen.findByTestId('world-duplicate-vob'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops.map((op) => op.op)).toEqual(['AddVob']);
    expect(readsBeforeCommit).toBe(0);
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

  it('is offered for a selection of any size', async () => {
    // D4 (level-editor.md §16.14). An append moves no path, so a selection
    // duplicates whole — and the button that used to copy only the primary of
    // five is what that removes. The delete beside it was the counter-example
    // until #253 gave a delete batch an order that survives the renumbering.
    await openWorld();

    act(() => useWorldStore.getState().selectVob(null));
    expect(await screen.findByTestId('world-duplicate-vob')).toBeDisabled();
    await act(async () => { useWorldStore.getState().selectVob(1); });
    expect(screen.getByTestId('world-duplicate-vob')).toBeEnabled();
    await act(async () => { useWorldStore.getState().toggleVob(0); });
    expect(screen.getByTestId('world-duplicate-vob')).toBeEnabled();
    // And it says how many, because the singular label on a five-VOB selection
    // would be describing an edit the button no longer makes — in the
    // accessible name now, an icon button having no visible text of its own.
    expect(screen.getByTestId('world-duplicate-vob')).toHaveAccessibleName('Duplicate 2 VOBs');
    expect(screen.getByTestId('world-delete-vob')).toHaveAccessibleName('Delete 2 VOBs');
  });

  it('is bound to Ctrl+D, the key every level editor duplicates with (#253)', async () => {
    // It was bound to nothing, so the context menu showed a blank shortcut
    // slot beside Frame, Copy, Paste and Delete. Daniel, 2026-09-12: Ctrl+D.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);

    await act(async () => { useWorldStore.getState().selectVob(1); });
    await act(async () => { fireEvent.keyDown(window, { key: 'd', ctrlKey: true }); });

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops[0]).toMatchObject({ op: 'AddVob' });
  });

  it('duplicates the whole selection on Ctrl+D, as the button does', async () => {
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValueOnce(summary as never);

    await act(async () => { useWorldStore.getState().selectVob(1); });
    await act(async () => { useWorldStore.getState().toggleVob(0); });
    await act(async () => { fireEvent.keyDown(window, { key: 'd', ctrlKey: true }); });

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops.filter((op) => op.op === 'AddVob')).toHaveLength(2);
  });

  it('does nothing on Ctrl+D with nothing selected', async () => {
    // A duplicate of nothing is an empty batch, which would still be an undo
    // entry — and Ctrl+D in a browser is a bookmark, so an unclaimed keystroke
    // is better left unclaimed.
    await openWorld();

    await act(async () => { useWorldStore.getState().selectVob(null); });
    await act(async () => { fireEvent.keyDown(window, { key: 'd', ctrlKey: true }); });

    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('leaves Ctrl+D alone in a text field, as it leaves Ctrl+C', async () => {
    // The same window-listener guard every other shortcut here carries.
    await openWorld();

    await act(async () => { useWorldStore.getState().selectVob(1); });
    await act(async () => { fireEvent.keyDown(coordinate('x'), { key: 'd', ctrlKey: true }); });

    expect(api.applyWorldOps).not.toHaveBeenCalled();
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

describe('the property grid locator (level-editor.md §16.24 6)', () => {
  // Picking in the viewport left no way back to the selection: the tree's
  // locator is per row, and a VOB selected by clicking the world may not even
  // be scrolled into view there. The keyboard already does it — `.` frames the
  // selection — so this is the same command with a button on it.
  it('frames the described VOB', async () => {
    await openWorld();

    fireEvent.click(screen.getByTestId('world-prop-locate'));

    expect(mockFrameVob).toHaveBeenCalledWith(1);
  });

  it('frames the VOB the grid describes, not the first of a multi-selection', async () => {
    // The grid describes the last VOB in the selection — the one the rotate
    // gizmo anchors on — and the locator has to agree with what is on screen
    // beside it.
    await openWorld();
    await act(async () => { useWorldStore.getState().toggleVob(0); });

    fireEvent.click(screen.getByTestId('world-prop-locate'));

    expect(mockFrameVob).toHaveBeenCalledWith(0);
  });

  it('is not offered with nothing selected', async () => {
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(null); });

    expect(screen.queryByTestId('world-prop-locate')).not.toBeInTheDocument();
  });

  it('frames a VOB with no drawn instance at its stored position', async () => {
    // §16.24: the locator read the *scene* for a position, so every class the
    // viewport draws nothing for — zCVobSpot, oCItem, the trigger and zone
    // VOBs — was permanently unlocatable, not only after a paste. The index
    // carries a position for all of them, and that is what the camera jumps to.
    // VOB 0 is the fixture's undrawn one; VOB 1 carries the only instance.
    const warned = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFrameVob.mockReturnValue('not-drawn' as never);
    // The real handle answers null for a jump that landed.
    mockFramePoint.mockReturnValue(null as never);
    await openWorld();
    await act(async () => { useWorldStore.getState().selectVob(0); });

    fireEvent.click(screen.getByTestId('world-prop-locate'));

    expect(mockFramePoint).toHaveBeenCalledWith([0, 0, 0]);
    expect(warned).not.toHaveBeenCalled();
    warned.mockRestore();
  });

  it('says so when the jump does nothing, rather than failing silently', async () => {
    // §16.24 5. The locator's whole path was optional-chained, so a jump that
    // could not be made was indistinguishable from one that was — which is why
    // a locator that had stopped working went unreported for a session.
    const warned = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFrameVob.mockReturnValueOnce('no-scene' as never);
    await openWorld();

    fireEvent.click(screen.getByTestId('world-prop-locate'));

    expect(warned).toHaveBeenCalledWith(expect.stringContaining('no-scene'));
    warned.mockRestore();
  });
});

describe('copying and pasting a VOB', () => {
  // D3 (level-editor.md §16.14): duplicate taken apart into two verbs. The
  // clipboard is in-process and holds *subtrees* — what the rows said when Ctrl+C
  // was pressed — so where a copy lands is chosen at the paste, and the paste
  // is still a batch of pure adds and still one undo entry.
  // Awaited, because a copy reads the class properties of what it copies before
  // it fills the clipboard (§14.1 1.2) — one round trip, and the clipboard is
  // what it was until it answers.
  const copy = async () => {
    await act(async () => { fireEvent.keyDown(window, { key: 'c', ctrlKey: true }); });
  };
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

    await copy();
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
        // Offset from the original (§16.24 4): a copy landing on top of its
        // source is invisible, and only findable in the scene tree. The barrel's
        // own box is 2 cm across, so the offset is `PASTE_MIN_OFFSET`.
        position: [10 + PASTE_MIN_OFFSET, 20, 30],
        rotation: IDENTITY,
        bbox: placeBounds(
          [-1, 0, -10, 1, 2, 10], IDENTITY, [10 + PASTE_MIN_OFFSET, 20, 30],
        ),
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
    await copy();
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

    await copy();
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
    await copy();
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

  it('selects the copies it pasted, so they can be dragged straight away', async () => {
    // §16.24 4: the paste committed its ops and the selection still held the
    // *source*, so a copy that had just landed could only be reached by hunting
    // for it in the scene tree.
    //
    // The flat index of an appended VOB is not knowable until the world has
    // been re-enumerated — the `vob` an `AddVob` carries is the enumeration as
    // it was — so the selection is resolved from the op's *path* against the
    // refreshed index.
    await openWorld();
    // Three VOBs after the paste: the two the world had, and the copy appended
    // to the roots as slot 2.
    const pasted = {
      ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30], [110, 20, 30]]),
    };
    expectRefresh(pasted);

    await copy();
    await act(async () => { paste(); });

    await waitFor(() => expect(api.refreshWorldIndex).toHaveBeenCalled());
    await waitFor(() => expect(useWorldStore.getState().selection).toEqual([2]));
  });

  it('leaves the selection alone when the paste is refused', async () => {
    // Nothing landed, so there is nothing to select — and selecting a path that
    // happens to resolve in the unchanged index would put the gizmo on a VOB
    // nobody pasted.
    await openWorld();
    api.applyWorldOps.mockRejectedValueOnce(new Error('nope') as never);

    await copy();
    await act(async () => { paste(); });

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    expect(useWorldStore.getState().selection).toEqual([1]);
  });

  it('carries the class properties across the clipboard', async () => {
    // Read at the copy, like everything else on the clipboard (§14.1 1.2): the
    // paste sends the fields the light had when Ctrl+C was pressed, not the ones
    // it has now — which is what lets a paste outlive the VOB it came from.
    vp.vobProps = LIGHT_PROPS;
    const summary = await openWorld(['zCVob', 'zCVobLight']);
    expectRefresh(summary);

    await copy();
    // The world's own answer changes under the clipboard, and the paste is
    // unmoved by it.
    vp.vobProps = { ...LIGHT_PROPS, range: 50 };
    paste();

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops.map((op) => op.op)).toEqual(['AddVob', 'SetVobClassProp']);
    expect(ops[1]).toMatchObject({
      op: 'SetVobClassProp',
      path: '2',
      className: 'zCVobLight',
      to: { lightType: 0, range: 2000, color: [255, 220, 180, 255], quality: 2 },
    });
  });

  it('pastes the same clipboard again, so a copy is not consumed', async () => {
    const summary = await openWorld();
    expectRefresh(summary);
    expectRefresh(summary);

    await copy();
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

    await copy();
    act(() => useWorldStore.getState().selectVob(null));
    await copy();
    act(() => useWorldStore.getState().selectVob(0));
    paste();

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalled());
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect((ops[0] as { to: Record<string, unknown> }).to).toMatchObject({ name: 'BARREL' });
  });

  it('does nothing at all when nothing has been copied', async () => {
    await openWorld();

    paste();

    await waitFor(() => expect(vp.selection).toEqual([1]));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('leaves Ctrl+C alone in a text field, where the browser owns it', async () => {
    // The property grid is full of inputs and this is a *window* listener, so
    // the guard is the same one the bare W and E shortcuts carry: a copy typed
    // into a coordinate is the user copying a number.
    await openWorld();

    fireEvent.keyDown(coordinate('x'), { key: 'c', ctrlKey: true });
    paste();

    await waitFor(() => expect(vp.selection).toEqual([1]));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });
});
