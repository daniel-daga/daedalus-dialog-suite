// First: the mock factories below read it, and the imports after it load them.
import * as mockViewportStub from './worldSurfaceViewportStub';
import React from 'react';
import { describe, it, expect } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createVobReader, type WorldOp } from 'zen-world';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { MOVE, vobIndex } from './worldFixtures';
import { TERRAIN, vp } from './worldSurfaceViewportStub';
import { VISUAL_SWAP_UNDONE, api, lastRender, openWorld } from './worldSurfaceEditingHarness';

/**
 * The World surface's half of an edit — placing VOBs, and undo/redo. Fixtures, the
 * viewport stub and `openWorld` are in `worldSurfaceEditingHarness.tsx`.
 */

jest.mock('react-virtualized-auto-sizer', () => mockViewportStub.autoSizerStub);
jest.mock('../src/renderer/components/world/WorldViewport', () => mockViewportStub.viewportStubModule());

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

  it('gives a placed VOB collision, except when its visual is a bush or grass (#291)', async () => {
    // Said explicitly on the op rather than left to the binding's default, so
    // the op says what the user gets and a change of default cannot move it.
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValue(summary as never);
    api.getWorldVisuals.mockResolvedValue({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    await place('NW_CRATE.3DS');
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const [crate] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(crate[0]).toMatchObject({ to: { visual: 'NW_CRATE.3DS', cdStatic: true, cdDynamic: true } });

    await place('NW_NATURE_BUSH_01.3DS');
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(2));
    const [bush] = api.applyWorldOps.mock.calls[1] as unknown as [WorldOp[]];
    expect(bush[0]).toMatchObject({ to: { visual: 'NW_NATURE_BUSH_01.3DS', cdStatic: false, cdDynamic: false } });
  });

  it('takes the project’s category override over the name rule (#291)', async () => {
    // The sidecar files the crate under a category set to "off" — by its
    // compiled name, which is the same visual as the source name placed.
    useProjectStore.setState({ projectFilePath: 'C:/mod/mymod.gothicproject.json' } as never);
    api.getAssetCatalog.mockResolvedValue({
      favorites: [], categories: [{ path: 'Mine/Walkthrough', visuals: ['NW_CRATE.MRM'], collision: false }],
    } as never);
    const summary = await openWorld();
    api.refreshWorldIndex.mockResolvedValue(summary as never);
    api.getWorldVisuals.mockResolvedValue({ visuals: [], stats: { vobsPlaced: 0 } } as never);
    await waitFor(() => expect(api.getAssetCatalog).toHaveBeenCalled());

    await place('NW_CRATE.3DS');
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops[0]).toMatchObject({ to: { visual: 'NW_CRATE.3DS', cdStatic: false, cdDynamic: false } });
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
    // 18 iterations, each a structural op — since slice 4 that is also an
    // awaited `getWorldHistoryDepth` round trip and a re-render of the World
    // bar, which pushes this loop past Jest's default 5s budget on a loaded
    // machine.
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
      // The three MOBs retail names consistently get that name in the add's
      // own batch, however the class was chosen; nothing else gets a second op.
      const focusName = ({
        oCMobDoor: 'MOBNAME_DOOR', oCMobContainer: 'MOBNAME_CHEST', oCMobSwitch: 'MOBNAME_SWITCH',
      } as Record<string, string>)[className];
      expect(ops).toHaveLength(focusName === undefined ? 1 : 2);
      if (focusName !== undefined) {
        expect(ops[1]).toMatchObject({ op: 'SetVobClassProp', className, to: { focusName } });
      }
      expect(ops[0]).toMatchObject({ op: 'AddVob', to: { class: className, position: TERRAIN } });
      const { to } = ops[0] as { to: Record<string, unknown> };
      expect(to).not.toHaveProperty('instance');
      expect(to).not.toHaveProperty('visual');
    }
  }, 15000);

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
    expect(api.getWorldVisuals).toHaveBeenCalledTimes(1);   // the open, and no more
  });

  it('re-reads the visuals on an undo that swapped a visual, though it is not structural', async () => {
    // The one property change the viewport cannot follow by patching a column:
    // a different visual is a different mesh, in an `InstancedMesh` that may
    // not exist yet, so the payload has to be rebuilt. The forward edit pays
    // for it at its own call site; undo and redo never go through that site —
    // they apply what the main process says it did — so the trigger has to sit
    // where they land. The index is *not* re-read: nothing renumbered.
    await openWorld();
    api.undoWorldEdit.mockResolvedValueOnce([VISUAL_SWAP_UNDONE] as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => expect(api.getWorldVisuals).toHaveBeenCalledTimes(2));
    expect(api.refreshWorldIndex).not.toHaveBeenCalled();
  });

  it('re-reads the visuals once for a forward visual edit, not twice', async () => {
    // The trigger above is the only one: the grid's commit goes through the
    // same `applied`, so a second hand-written fetch beside it would pay an
    // open's worth of work twice for every visual change.
    await openWorld();
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);

    const visualInput = screen.getByTestId('world-prop-visual-input') as HTMLInputElement;
    fireEvent.change(visualInput, { target: { value: 'CRATE.3DS' } });
    fireEvent.blur(visualInput);

    await waitFor(() => expect(api.getWorldVisuals).toHaveBeenCalledTimes(2));
    // Settled: any second fetch would have been issued by now.
    await act(async () => {});
    expect(api.getWorldVisuals).toHaveBeenCalledTimes(2);
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
    const before = screen.getByTestId('world-status-bar');

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));

    expect(await screen.findByTestId('world-place-vob')).toBeInTheDocument();
    expect(screen.getByTestId('world-status-bar')).toBe(before);
  });

  it('tells the viewport where to draw the point the bar names', async () => {
    // "Place VOB here…" names coordinates, and coordinates are not a place
    // anybody can see. The viewport draws a marker there; this is the only
    // seam between the two.
    await openWorld();
    expect(vp.terrainPoint).toBeNull();

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    await waitFor(() => expect(vp.terrainPoint).toEqual(TERRAIN));

    // And it goes away with the point: a hit on a VOB is not a point on the
    // ground, and a marker left behind names a placement that is no longer on
    // offer.
    fireEvent.click(screen.getByTestId('stub-pick-vob'));
    await waitFor(() => expect(screen.queryByTestId('world-place-vob')).not.toBeInTheDocument());
    expect(vp.terrainPoint).toBeNull();
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
    expect(vp.appliedOps).toEqual([inverse]);
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
    expect(vp.appliedOps).toBeNull();
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
