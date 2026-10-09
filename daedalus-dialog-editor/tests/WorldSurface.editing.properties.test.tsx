// First: the mock factories below read it, and the imports after it load them.
import * as mockViewportStub from './worldSurfaceViewportStub';
import React from 'react';
import { describe, it, expect } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createVobReader, placeBounds, type ZenRotation } from 'zen-world';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, WAYPOINT_WAS, vobIndex } from './worldFixtures';
import {
  mockFramePoint, mockFramePolygon, mockFrameVob, mockRaycastDown, vp,
} from './worldSurfaceViewportStub';
import { ITEM_PROPS, LIGHT_PROPS, ZONE_PROPS, api, openWorld } from './worldSurfaceEditingHarness';

/**
 * The World surface's half of an edit — class properties, and the viewport tools. Fixtures, the
 * viewport stub and `openWorld` are in `worldSurfaceEditingHarness.tsx`.
 */

jest.mock('react-virtualized-auto-sizer', () => mockViewportStub.autoSizerStub);
jest.mock('../src/renderer/components/world/WorldViewport', () => mockViewportStub.viewportStubModule());

describe('a class property edited in the grid', () => {
  /** VOB 1 as a light, with its class fields already on screen. */
  async function openLight() {
    vp.vobProps = LIGHT_PROPS;
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
    vp.vobProps = LIGHT_PROPS;
    await openWorld(['oCItem', 'zCVobLight']);
    await screen.findByTestId('world-prop-class-range-input');

    vp.vobProps = ITEM_PROPS;
    await act(async () => { useWorldStore.getState().selectVob(0); });
    expect((screen.getByTestId('world-prop-class-instance-input') as HTMLInputElement).value)
      .toBe('ITMW_1H_SWORD_01');

    vp.vobProps = LIGHT_PROPS;
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

  it('re-labels the scene tree row when the name is committed', async () => {
    // The wiring for the tree's half of the same write: `applyEdit` puts the
    // new name in the summary's columns without changing one identity React
    // compares, so the row is only re-read because the applied ops reach the
    // tree as a prop. A green tree test with nothing handing it the ops is the
    // failure this catches.
    await openWorld();
    expect(screen.getByTestId('world-vob-row-1')).toHaveTextContent('BARREL');

    const nameInput = screen.getByTestId('world-prop-name-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'CRATE' } });
    fireEvent.blur(nameInput);

    await waitFor(() => expect(screen.getByTestId('world-vob-row-1'))
      .toHaveTextContent('CRATE'));
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
    vp.vobProps = ITEM_PROPS;
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
    vp.vobProps = { ...LIGHT_PROPS, range: 3000 };

    const readsBeforeCommit = api.getVobProps.mock.calls.length;
    commitRange('3000');
    // The commit's own re-read, not the typed value: that is on screen before
    // the commit lands, and swapping the mock below ahead of the re-read would
    // have it answer 2000 as well — the undo's read then changes nothing.
    await waitFor(() => expect(api.getVobProps.mock.calls.length).toBeGreaterThan(readsBeforeCommit));
    await waitFor(() => expect(rangeInput().value).toBe('3000'));

    vp.vobProps = LIGHT_PROPS;
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

describe('a failure after the world has already taken the edit', () => {
  // One shape in two places: a `try` that spans past the commit point. What
  // runs after it is the renderer catching up with a world that has changed,
  // and a failure there is a stale *view* — never a refusal. Reported as one it
  // is worse than nothing: the banner says the edit did not happen, the
  // viewport is handed the inverse and visibly undoes it, and the main process
  // still holds the op — on the undo stack, and written on save.

  /** Pick terrain, open the placement dialog and confirm it. */
  async function place(visual: string) {
    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    act(() => useWorldStore.getState().selectVob(null));
    fireEvent.click(await screen.findByTestId('world-place-vob'));
    fireEvent.change(screen.getByTestId('world-place-visual'), { target: { value: visual } });
    fireEvent.click(screen.getByTestId('world-place-confirm'));
  }

  it('says the placement was applied when the index re-read fails, and leaves it drawn', async () => {
    await openWorld();
    // The re-read is one of four fallible steps `applied` runs *after*
    // `applyWorldOps` resolved — a restarted worker rejects it.
    api.refreshWorldIndex.mockRejectedValueOnce(new Error('world worker exited') as never);

    await place('NW_CRATE.3DS');

    await waitFor(() => expect(api.refreshWorldIndex).toHaveBeenCalled());
    const banner = await screen.findByTestId('world-edit-error');
    expect(banner).toHaveTextContent(/world worker exited/);
    expect(banner).toHaveTextContent(/applied/i);
    // The viewport keeps the forward op. The inverse of this one is an `AddVob`
    // with `to: null` — undrawing a VOB the world still has.
    expect(vp.appliedOps).toHaveLength(1);
    expect(vp.appliedOps![0]).toMatchObject({ op: 'AddVob', vob: 2 });
    expect((vp.appliedOps![0] as { to: unknown }).to).not.toBeNull();
  });

  it("drops the previous world's waynet when the next world opens", async () => {
    await openWorld();
    expect(vp.waynet?.names).toEqual(['WP_START', 'WP_MIDDLE', 'WP_END']);

    // World B, whose waynet never arrives — a transient worker error, which is
    // reported over a world that stays open. World A's payload must not be what
    // the overlay goes on drawing and a drag goes on building ops from: the
    // names would be A's, checked against B's waynet by the binding's name
    // guard, and refused for a reason nobody could read off the screen.
    const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]) };
    api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/OldWorld.zen' as never);
    api.openWorld.mockResolvedValueOnce(summary as never);
    api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
    api.getWorldWaynet.mockRejectedValueOnce(new Error('worker exited') as never);

    fireEvent.click(screen.getByTestId('world-open'));

    // Open world lists the project's worlds (level-editor.md §16.31); these

    // suites want a named file, which is what Browse… still is.

    fireEvent.click(await screen.findByTestId('world-picker-browse'));

    await waitFor(() => expect(screen.getByTestId('world-edit-error')).toHaveTextContent(
      /worker exited/,
    ));
    expect(vp.waynet).toBeNull();
    expect(useWorldStore.getState().waynetNames).toBeNull();
  });

  it('keeps the opened world when the waynet read fails', async () => {
    // The waynet is read at the end of the open, after `openSucceeded` has
    // already published a `ready` world. Routed to `openFailed` it throws away
    // the summary, the ~31 MB mesh and the visuals over a payload nothing but
    // the overlay and the Problems scan needs — while the main process goes on
    // holding the world.
    const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]) };
    api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
    api.openWorld.mockResolvedValueOnce(summary as never);
    api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
    api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
    api.getWorldWaynet.mockRejectedValueOnce(new Error('worker exited') as never);

    render(<WorldSurface />);
    fireEvent.click(screen.getByTestId('world-open'));
    // Open world lists the project's worlds (level-editor.md §16.31); these
    // suites want a named file, which is what Browse… still is.
    fireEvent.click(await screen.findByTestId('world-picker-browse'));

    await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('world-edit-error')).toHaveTextContent(
      /worker exited/,
    ));
    expect(useWorldStore.getState().status).toBe('ready');
    expect(useWorldStore.getState().summary).toBe(summary);
    // Null is "nothing is known", which is the contract the waypoint rule
    // already reads — never "no waypoint is legal".
    expect(useWorldStore.getState().waynetNames).toBeNull();
    expect(screen.queryByTestId('world-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('world-viewport-stub')).toBeInTheDocument();
  });
});


/**
 * A world finding clicked in the Problems panel (§16.20 slice 2). The panel
 * cannot reach the viewport — it is not even mounted while another view is on
 * screen — so it leaves a request in the store and this is the half that takes
 * it: select the thing, jump the camera, clear the request.
 */
describe('a focus request from outside the surface', () => {
  it('selects and frames the VOB it names', async () => {
    await openWorld();

    await act(async () => {
      useWorldStore.getState().requestFocus({ kind: 'vob', vob: 1 });
    });

    expect(useWorldStore.getState().selection).toEqual([1]);
    expect(mockFrameVob).toHaveBeenCalledWith(1);
    // Consumed, so the next click on the same finding is a second jump.
    expect(useWorldStore.getState().focusRequest).toBeNull();
  });

  it('selects the waypoint it names, shows the overlay and frames the point', async () => {
    await openWorld();

    // Lowercase on purpose: Daedalus is case-insensitive and the name comes
    // out of a script, not out of the waynet.
    await act(async () => {
      useWorldStore.getState().requestFocus({ kind: 'waypoint', name: 'wp_middle' });
    });

    expect(useWorldStore.getState().selectedWaypoint).toBe(1);
    expect(mockFramePoint).toHaveBeenCalledWith(WAYPOINT_WAS);
    // Without the overlay the gizmo would stand where there is no dot to see —
    // the same reason switching it off clears the selected waypoint.
    expect(vp.showWaynet).toBe(true);
    expect(useWorldStore.getState().focusRequest).toBeNull();
  });

  it('frames and outlines the portal polygon a finding names (#222)', async () => {
    await openWorld();
    mockFramePolygon.mockReturnValue(null as never);
    const corners = [[10, 0, 0], [10, 100, 0], [10, 100, 100], [10, 0, 100]] as const;
    const selectionWas = useWorldStore.getState().selection;

    await act(async () => {
      useWorldStore.getState().requestFocus({ kind: 'polygon', polygon: 456754, corners });
    });

    // The geometry, not the index: the scene holds merged draw groups and
    // cannot turn one into the other.
    expect(mockFramePolygon).toHaveBeenCalledWith(corners);
    // A portal has no row in the VOB index and no dot in the waynet, so
    // neither selection moves — the outline is the whole of what is shown.
    expect(useWorldStore.getState().selection).toEqual(selectionWas);
    expect(useWorldStore.getState().selectedWaypoint).toBeNull();
    expect(mockFrameVob).not.toHaveBeenCalled();
    expect(mockFramePoint).not.toHaveBeenCalled();
    expect(useWorldStore.getState().focusRequest).toBeNull();
  });

  it('says so when a portal jump lands nowhere, rather than failing silently', async () => {
    // §16.24 5: a locator that has stopped working must not be indistinguishable
    // from one that jumped to something already on screen.
    await openWorld();
    mockFramePolygon.mockReturnValue('not-drawn' as never);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      useWorldStore.getState().requestFocus({
        kind: 'polygon', polygon: 456754, corners: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      });
    });

    expect(warn).toHaveBeenCalledWith('Could not jump to polygon 456754: not-drawn');
    warn.mockRestore();
  });

  it('takes the request and jumps nowhere for a name this waynet has not', async () => {
    await openWorld();

    await act(async () => {
      useWorldStore.getState().requestFocus({ kind: 'waypoint', name: 'WP_NOWHERE' });
    });

    expect(useWorldStore.getState().selectedWaypoint).toBeNull();
    expect(mockFramePoint).not.toHaveBeenCalled();
    expect(useWorldStore.getState().focusRequest).toBeNull();
  });

  /**
   * A free point is a `zCVobSpot` VOB and not a waypoint, so a name the waynet
   * does not have may still be a place — and the jump has to land on the VOB.
   * Without this the button that offers the jump is enabled and does nothing,
   * which is a worse answer than the disabled one it used to give.
   */
  it('selects and frames the free-point VOB a name reaches', async () => {
    await openWorld('zCVobSpot', undefined, ['FP_ROAM_CITY_00', 'FP_ROAM_CITY_01']);

    await act(async () => {
      useWorldStore.getState().requestFocus({ kind: 'waypoint', name: 'fp_roam_city_01' });
    });

    expect(useWorldStore.getState().selection).toEqual([1]);
    expect(mockFrameVob).toHaveBeenCalledWith(1);
    expect(useWorldStore.getState().selectedWaypoint).toBeNull();
    expect(useWorldStore.getState().focusRequest).toBeNull();
  });

  it('reaches a free point by a fragment, the way the engine does', async () => {
    await openWorld('zCVobSpot', undefined, ['BARREL', 'FP_ROAM_CITY_01']);

    await act(async () => {
      useWorldStore.getState().requestFocus({ kind: 'waypoint', name: 'ROAM' });
    });

    expect(mockFrameVob).toHaveBeenCalledWith(1);
  });

  it('does not take a VOB of another class for a free point', async () => {
    // The class is what makes a free point; the `FP_` name is a convention.
    await openWorld('zCVob', undefined, ['BARREL', 'FP_ROAM_CITY_01']);

    await act(async () => {
      useWorldStore.getState().requestFocus({ kind: 'waypoint', name: 'FP_ROAM_CITY_01' });
    });

    expect(mockFrameVob).not.toHaveBeenCalled();
    expect(useWorldStore.getState().focusRequest).toBeNull();
  });

  /**
   * `inWorld` — the world the NPC actually lives in (#226). The dialog editor
   * reads the `.ZEN` off the spawn site's own `STARTUP_` function and can name
   * it but not open it; opening a world is this surface's, so the name rides
   * the request and this is where it is resolved — through the same
   * project-source scan the world picker lists (§16.31), which is why no
   * world-directory setting was needed to get here.
   */
  describe('a request naming a world that is not open', () => {
    const WORLDS = [
      { path: 'C:/Gothic/_work/Data/Worlds/OldWorld.zen', name: 'OldWorld.ZEN', source: 'C:/Gothic', isDefault: false },
      { path: 'C:/Gothic/_work/Data/Worlds/NewWorld.zen', name: 'NewWorld.ZEN', source: 'C:/Gothic', isDefault: true },
    ];

    /** The open the resolved path is expected to make, stubbed through. */
    const stubOpen = () => {
      const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]) };
      api.openWorld.mockResolvedValueOnce(summary as never);
      api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
      api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
      return summary;
    };

    it('opens that world, then makes the jump in it', async () => {
      api.listWorlds.mockResolvedValueOnce(WORLDS as never);
      stubOpen();
      render(<WorldSurface />);

      await act(async () => {
        useWorldStore.getState().requestFocus(
          { kind: 'waypoint', name: 'wp_middle', inWorld: 'NEWWORLD' },
        );
      });

      await waitFor(() => expect(api.openWorld).toHaveBeenCalledWith(
        expect.objectContaining({ worldPath: 'C:/Gothic/_work/Data/Worlds/NewWorld.zen' }),
      ));
      // The jump itself is re-issued after the open, because the waynet it
      // needs is the one *this* open has just read.
      await waitFor(() => expect(mockFramePoint).toHaveBeenCalledWith(WAYPOINT_WAS));
      expect(useWorldStore.getState().selectedWaypoint).toBe(1);
      expect(vp.showWaynet).toBe(true);
      expect(useWorldStore.getState().focusRequest).toBeNull();
    });

    it('says so and opens nothing when the project has no such world', async () => {
      api.listWorlds.mockResolvedValueOnce([WORLDS[0]] as never);
      render(<WorldSurface />);

      await act(async () => {
        useWorldStore.getState().requestFocus(
          { kind: 'waypoint', name: 'WP_MIDDLE', inWorld: 'NEWWORLD' },
        );
      });

      await waitFor(() => expect(screen.getByTestId('world-edit-error')).toHaveTextContent(
        /NEWWORLD\.ZEN/,
      ));
      expect(api.openWorld).not.toHaveBeenCalled();
      expect(useWorldStore.getState().focusRequest).toBeNull();
    });

    it('reports a scan that failed rather than leaving the click unanswered', async () => {
      api.listWorlds.mockRejectedValueOnce(new Error('sources unreadable') as never);
      render(<WorldSurface />);

      await act(async () => {
        useWorldStore.getState().requestFocus(
          { kind: 'waypoint', name: 'WP_MIDDLE', inWorld: 'NEWWORLD' },
        );
      });

      await waitFor(() => expect(screen.getByTestId('world-edit-error')).toHaveTextContent(
        /sources unreadable/,
      ));
      expect(api.openWorld).not.toHaveBeenCalled();
    });

    it('makes no jump when the open itself failed', async () => {
      // A refused open replaces the whole surface with its own error, and
      // there is no world left to fly through.
      api.listWorlds.mockResolvedValueOnce(WORLDS as never);
      api.openWorld.mockRejectedValueOnce(new Error('no asset source') as never);
      render(<WorldSurface />);

      await act(async () => {
        useWorldStore.getState().requestFocus(
          { kind: 'waypoint', name: 'WP_MIDDLE', inWorld: 'NEWWORLD' },
        );
      });

      await waitFor(() => expect(useWorldStore.getState().status).toBe('error'));
      expect(mockFramePoint).not.toHaveBeenCalled();
      expect(useWorldStore.getState().selectedWaypoint).toBeNull();
      expect(useWorldStore.getState().focusRequest).toBeNull();
    });
  });

  /**
   * `{ kind: 'add-waypoint' }` — the Problems panel's "Add to world" action on
   * a `waypoint-not-in-world` finding. Unlike the other two kinds it is not a
   * jump: a script naming a place is not a position, so there is nothing to
   * frame yet. What it arms is the same terrain click `world-add-waypoint`
   * already takes — this only supplies the overlay and the name.
   */
  describe('the "add-waypoint" kind', () => {
    it('shows the overlay and takes the request without framing anything', async () => {
      await openWorld();

      await act(async () => {
        useWorldStore.getState().requestFocus({ kind: 'add-waypoint', name: 'OW_PATH_42' });
      });

      expect(vp.showWaynet).toBe(true);
      expect(mockFramePoint).not.toHaveBeenCalled();
      expect(mockFrameVob).not.toHaveBeenCalled();
      expect(useWorldStore.getState().focusRequest).toBeNull();
    });

    it('pre-fills the next "Add waypoint here" dialog with the armed name', async () => {
      await openWorld();
      await act(async () => {
        useWorldStore.getState().requestFocus({ kind: 'add-waypoint', name: 'OW_PATH_42' });
      });

      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      fireEvent.click(await screen.findByTestId('world-add-waypoint'));

      expect(screen.getByTestId('world-waypoint-add-name')).toHaveValue('OW_PATH_42');
    });

    it('commits the armed name as the AddWaypoint op, not a suggested one', async () => {
      await openWorld();
      await act(async () => {
        useWorldStore.getState().requestFocus({ kind: 'add-waypoint', name: 'OW_PATH_42' });
      });

      fireEvent.click(screen.getByTestId('stub-pick-terrain'));
      act(() => useWorldStore.getState().selectVob(null));
      fireEvent.click(await screen.findByTestId('world-add-waypoint'));
      fireEvent.click(screen.getByTestId('world-waypoint-add-confirm'));

      await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([
        expect.objectContaining({ op: 'AddWaypoint', name: 'OW_PATH_42' }),
      ]));
    });

    it('shows a hint naming the armed waypoint before the ground is clicked', async () => {
      await openWorld();

      await act(async () => {
        useWorldStore.getState().requestFocus({ kind: 'add-waypoint', name: 'OW_PATH_42' });
      });

      expect(screen.getByTestId('world-terrain-hint')).toHaveTextContent('OW_PATH_42');
    });
  });
});

// How far the selected VOB reaches (level-editor.md §16.39, #248). The marker
// layer put a dot where a light stands; the range is what a modder is actually
// tuning, and until it is drawn tuning one is a save-and-play loop.
describe('the volume round the selection', () => {
  it("hands the viewport a light's range and its colour, off the props the grid already read", async () => {
    // No round trip of its own: this is the same `getVobProps` the property
    // grid makes on every selection change, and `color` is as catalogued a
    // field of `zCVobLight` as `range` is — so the second half of #248 cost
    // the same nothing the first did.
    vp.vobProps = LIGHT_PROPS;
    await openWorld(['zCVob', 'zCVobLight']);

    await act(async () => { useWorldStore.getState().selectVob(1); });
    await waitFor(() => expect(api.getVobProps).toHaveBeenCalled());

    await waitFor(() => expect(vp.selectedExtent).toEqual({
      vob: 1,
      // The alpha is dropped: a light's alpha is not its tint.
      extent: { shape: 'sphere', radius: LIGHT_PROPS.range, kind: 'light', color: [255, 220, 180] },
    }));
  });

  it("hands it a zone's box off the same read, which is the fetch #248 chose", () => {
    // The bbox is in no column of the index, so drawing a zone means either
    // paying 41,393 × 6 floats at every world load or fetching per selection.
    // This is the second, and its whole cost is that `getVobProps` answers one
    // more key.
    vp.vobProps = ZONE_PROPS;
    return openWorld(['zCVob', 'oCZoneMusic']).then(async () => {
      await act(async () => { useWorldStore.getState().selectVob(1); });
      await waitFor(() => expect(api.getVobProps).toHaveBeenCalled());

      await waitFor(() => expect(vp.selectedExtent).toEqual({
        vob: 1,
        extent: { shape: 'box', kind: 'zone', bbox: ZONE_PROPS.bbox },
      }));
    });
  });

  it("follows the zone's own ellipsoid flag, because one box means two shapes", async () => {
    vp.vobProps = { ...ZONE_PROPS, ellipsoid: true };
    await openWorld(['zCVob', 'oCZoneMusic']);

    await act(async () => { useWorldStore.getState().selectVob(1); });
    await waitFor(() => expect(api.getVobProps).toHaveBeenCalled());

    await waitFor(() => expect(vp.selectedExtent?.extent.shape).toBe('ellipsoid'));
  });

  it('hands it nothing for a class that is no volume at all', async () => {
    // An `oCItem` has no reach and no volume anybody places it for; its bbox is
    // its model's, which the model already draws.
    vp.vobProps = ITEM_PROPS;
    await openWorld(['zCVob', 'oCItem']);

    await act(async () => { useWorldStore.getState().selectVob(1); });
    await waitFor(() => expect(api.getVobProps).toHaveBeenCalled());

    await waitFor(() => expect(vp.selectedExtent).toBeNull());
  });
});
