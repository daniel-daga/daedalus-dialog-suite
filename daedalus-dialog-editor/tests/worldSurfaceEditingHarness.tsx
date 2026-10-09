import { beforeEach } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { type WorldOp } from 'zen-world';
import WorldSurface from '../src/renderer/components/world/WorldSurface';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { BASE_PROPS, SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';
import { mockFramePoint, mockFramePolygon, mockFrameVob, mockRaycastDown, vp } from './worldSurfaceViewportStub';

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
 *
 * Shared by the `WorldSurface.editing.*` suites, which were one 4,400-line file
 * that ran for four minutes on one Jest worker. The viewport stub itself is
 * `worldSurfaceViewportStub.tsx`; importing this module installs the shared
 * `beforeEach`/`afterEach`.
 */

export const LIGHT_PROPS = {
  class: 'zCVobLight', range: 2000, color: [255, 220, 180, 255],
  lightType: 0, quality: 2, ...BASE_PROPS,
};
export const ITEM_PROPS = { class: 'oCItem', instance: 'ITMW_1H_SWORD_01', ...BASE_PROPS };
/** A music zone as `getVobProps` answers one — `bbox` is the per-selection
 *  fetch #248 chose over an index column, and `ellipsoid` is the catalogued
 *  bool that makes those same six numbers mean two shapes. */
export const ZONE_PROPS = {
  class: 'oCZoneMusic', enabled: true, priority: 5, ellipsoid: false,
  reverb: 0, volume: 1, loop: true,
  bbox: [-1000, 0, -500, 1000, 800, 500], ...BASE_PROPS,
};

/** What the main process hands back for an undo of a visual swap: the op the
 *  edit was, with its sides already exchanged. Not structural — no VOB came or
 *  went — and yet the scene has to be rebuilt from it. */
export const VISUAL_SWAP_UNDONE: WorldOp = {
  op: 'SetVobProp',
  vob: 1,
  path: '1',
  from: { visual: 'CRATE.3DS' },
  to: { visual: 'BARREL.3DS' },
  fromBbox: null,
  toBbox: null,
};

/** One axis of the property grid's typed position — an input, so its value is
 *  not its text content. */
export const coordinate = (axis: string) => screen.getByTestId(
  `world-prop-position-${axis}-input`,
) as HTMLInputElement;

export const api = makeWorldEditorApi();
api.getVobProps.mockImplementation(async () => vp.vobProps);

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
export let lastRender: ReturnType<typeof render>;

export async function openWorld(
  cls?: string | readonly string[], parents?: readonly number[], vobNames?: readonly string[],
) {
  const summary = {
    ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]], cls, parents, vobNames),
  };
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
  // Open world lists the project's worlds (level-editor.md §16.31); these
  // suites want a named file, which is what Browse… still is.
  fireEvent.click(await screen.findByTestId('world-picker-browse'));
  await screen.findByTestId('stub-drag');
  // Awaited, not the bare synchronous `act`: selecting a VOB of a catalogued
  // class issues the per-class read, and its answer lands a microtask after the
  // selection — outside an `act` that has already returned.
  await act(async () => { useWorldStore.getState().selectVob(1); });
  return summary;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Every world open reads the waynet now — its names are the Problems scan's
  // world input, not only the overlay's payload — so a default stands here for
  // the tests that do not care which one they get. A test that does queues its
  // own with `mockResolvedValueOnce` *before* opening.
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  vp.appliedOps = undefined;
  vp.terrainPoint = undefined;
  vp.exposure = undefined;
  vp.hiddenVobs = undefined;
  vp.snapGrid = undefined;
  vp.snapAngle = undefined;
  vp.waynet = undefined;
  vp.showWaynet = undefined;
  mockFramePoint.mockReset();
  mockFramePolygon.mockReset();
  vp.vobProps = { class: 'zCVob', ...BASE_PROPS };
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
