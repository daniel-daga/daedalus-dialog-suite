import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { WorldOp } from 'zen-world';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/shared/types';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';
import * as mockWorldViewport from './worldViewportMocks';
import WorldSurface from '../src/renderer/components/world/WorldSurface';

/**
 * The toolbar's Add group and the armed click it leads to (level-editor.md
 * §17, "Adding things"): Place VOB…, Insert NPC… and Add waypoint… open
 * their dialog first and take the ground click *afterwards* when none has
 * been chosen yet, and the Assets panel places a previewed mesh with no
 * dialog at all. Before this, every one of them was reachable only by
 * clicking the ground first — and two of them only with the Waynet overlay
 * switched on by hand.
 *
 * Playwright cannot reach any of this: the browser harness has no world.
 */

jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());

jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

const TERRAIN: [number, number, number] = [1500.5, -220, 3300.25];
let mockShowWaynet: boolean | undefined;

jest.mock('../src/renderer/components/world/WorldViewport', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    __esModule: true,
    default: ReactActual.forwardRef((props: {
      onPick: (vob: number | null, point: [number, number, number] | null, additive: boolean) => void;
      onSelectWaypoint: (waypoint: number | null) => void;
      showWaynet: boolean;
    }, ref: React.Ref<{
      raycastDown: () => null; frameVob: () => void; framePoint: () => void;
    }>) => {
      mockShowWaynet = props.showWaynet;
      ReactActual.useImperativeHandle(ref, () => ({
        raycastDown: () => null, frameVob: () => undefined, framePoint: () => undefined,
      }));
      return (
        <div data-testid="world-viewport-stub">
          <button type="button" data-testid="stub-pick-terrain" onClick={() => props.onPick(null, TERRAIN, false)}>
            pick terrain
          </button>
          <button type="button" data-testid="stub-pick-waypoint" onClick={() => props.onSelectWaypoint(1)}>
            pick waypoint
          </button>
        </div>
      );
    }),
  };
});

const STARTUP_PATH = 'C:/Story/Startup.d';
const STARTUP_MODEL: SemanticModel = {
  dialogs: {},
  functions: { STARTUP_NewWorld: { name: 'STARTUP_NewWorld', actions: [] } as never },
};

const api = makeWorldEditorApi();

async function openWorld() {
  const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]) };
  api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
  api.openWorld.mockResolvedValueOnce(summary as never);
  api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
  api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
  api.refreshWorldIndex.mockResolvedValue(summary as never);
  render(<WorldSurface />);
  fireEvent.click(screen.getByTestId('world-open'));
  fireEvent.click(await screen.findByTestId('world-picker-browse'));
  await screen.findByTestId('world-viewport-stub');
  await waitFor(() => expect(api.getWorldWaynet).toHaveBeenCalled());
  return summary;
}

const hint = () => screen.getByTestId('world-terrain-hint');
const firstOps = () => (api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]])[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockShowWaynet = undefined;
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  api.getWorldHistoryDepth.mockResolvedValue({ undo: 0, redo: 0 } as never);
  api.getVobProps.mockResolvedValue({ class: 'zCVob', presetName: '', visualCamAlign: 0, bias: 0 } as never);
  api.getVobFolders.mockResolvedValue({ folders: [] } as never);
  api.appendInsertNpc.mockResolvedValue({ ok: true, line: 7 } as never);
  // A structural op re-reads the index and the visuals; the re-read wants
  // an answer every time, not only on the open.
  api.getWorldVisuals.mockResolvedValue({ visuals: [], stats: { vobsPlaced: 0 } } as never);
  useProjectStore.setState({
    parsedFiles: new Map([[STARTUP_PATH, { filePath: STARTUP_PATH, semanticModel: STARTUP_MODEL, lastParsed: new Date() }]]),
  } as never);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
});

describe('Place VOB… from the toolbar', () => {
  it('opens the dialog with no ground point, and places on the next ground click', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-add-vob'));

    // The dialog says where the VOB goes — and here that is not a point yet.
    expect(screen.getByRole('dialog')).toHaveTextContent(/next click the ground/i);
    fireEvent.change(screen.getByTestId('world-place-visual'), { target: { value: 'NW_CRATE.3DS' } });
    fireEvent.click(screen.getByTestId('world-place-confirm'));

    // Nothing is sent yet: the status bar is armed and says with what.
    expect(api.applyWorldOps).not.toHaveBeenCalled();
    expect(hint()).toHaveTextContent('NW_CRATE.3DS');

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    expect(firstOps()[0]).toMatchObject({
      op: 'AddVob', vob: 2, path: '2', to: { visual: 'NW_CRATE.3DS', position: TERRAIN },
    });
    // Spent by the click, which also stands as an ordinary terrain pick: the
    // bar now shows the point, and nothing is waiting.
    expect(screen.queryByTestId('world-armed-cancel')).toBeNull();
    expect(screen.getByTestId('world-terrain-point')).toBeInTheDocument();
  });

  it('places at the ground point already chosen, the way the bar button does', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    fireEvent.click(screen.getByTestId('world-add-vob'));

    expect(screen.getByRole('dialog')).toHaveTextContent(/1501, -220, 3300/);
    fireEvent.change(screen.getByTestId('world-place-visual'), { target: { value: 'NW_CRATE.3DS' } });
    fireEvent.click(screen.getByTestId('world-place-confirm'));

    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    expect(firstOps()[0]).toMatchObject({ op: 'AddVob', to: { position: TERRAIN } });
  });

  it('is cancelled by Escape, and by the status bar', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-add-vob'));
    fireEvent.change(screen.getByTestId('world-place-visual'), { target: { value: 'NW_CRATE.3DS' } });
    fireEvent.click(screen.getByTestId('world-place-confirm'));
    expect(hint()).toHaveTextContent('NW_CRATE.3DS');

    fireEvent.click(screen.getByTestId('world-armed-cancel'));
    expect(hint()).not.toHaveTextContent('NW_CRATE.3DS');

    fireEvent.click(screen.getByTestId('world-add-vob'));
    fireEvent.click(screen.getByTestId('world-place-confirm'));
    expect(screen.getByTestId('world-armed-cancel')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('world-armed-cancel')).toBeNull();

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });
});

describe('Place in world from the Assets panel', () => {
  async function previewCrate() {
    api.listWorldAssets.mockResolvedValue([{ name: 'NW_CRATE.MRM', type: 'file' }] as never);
    fireEvent.click(screen.getByTestId('world-panel-assets'));
    fireEvent.click(await screen.findByTestId('world-asset-NW_CRATE.MRM'));
    await screen.findByTestId('world-asset-preview-name');
  }

  it('arms the previewed mesh and places it on the next ground click, with no dialog', async () => {
    // The gesture the picker used to need: preview, switch tabs, click the
    // ground, open the dialog, "Use previewed", Place. Now: preview, Place
    // in world, click the ground.
    await openWorld();
    await previewCrate();

    fireEvent.click(screen.getByTestId('world-asset-place'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(hint()).toHaveTextContent('NW_CRATE.MRM');

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    expect(firstOps()[0]).toMatchObject({
      op: 'AddVob', to: { visual: 'NW_CRATE.MRM', position: TERRAIN },
    });
  });
});

describe('Insert NPC… from the toolbar', () => {
  const instanceField = () =>
    within(screen.getByTestId('world-insert-npc-instance')).getByRole('combobox');
  const waypointField = () => screen.getByTestId('world-insert-npc-waypoint') as HTMLInputElement;

  it('turns the waynet overlay on, and takes the ground click after the dialog', async () => {
    await openWorld();
    expect(mockShowWaynet).toBe(false);

    fireEvent.click(screen.getByTestId('world-add-npc'));
    await screen.findByTestId('world-insert-npc-dialog');
    // The result is a waypoint, and only the overlay draws one.
    expect(mockShowWaynet).toBe(true);
    expect(waypointField().value).toBe('FP_NEW_3');
    fireEvent.change(instanceField(), { target: { value: 'PC_Thief' } });
    fireEvent.click(screen.getByTestId('world-insert-npc-confirm'));

    expect(api.appendInsertNpc).not.toHaveBeenCalled();
    expect(hint()).toHaveTextContent('FP_NEW_3');
    expect(hint()).toHaveTextContent('PC_Thief');

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    await waitFor(() => expect(api.appendInsertNpc).toHaveBeenCalledWith(
      STARTUP_PATH, 'STARTUP_NewWorld', 'PC_Thief', 'FP_NEW_3',
    ));
    expect(api.applyWorldOps).toHaveBeenCalledWith([{
      op: 'AddWaypoint', waypoint: 3, name: 'FP_NEW_3', from: null, to: TERRAIN,
    }]);
  });

  it('spawns at a waypoint the world already has when its name is typed, with no click and no op', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-add-npc'));
    await screen.findByTestId('world-insert-npc-dialog');

    fireEvent.change(waypointField(), { target: { value: 'WP_MIDDLE' } });
    expect(screen.getByRole('dialog')).toHaveTextContent(/already in this world/i);
    fireEvent.change(instanceField(), { target: { value: 'PC_Thief' } });
    fireEvent.click(screen.getByTestId('world-insert-npc-confirm'));

    await waitFor(() => expect(api.appendInsertNpc).toHaveBeenCalledWith(
      STARTUP_PATH, 'STARTUP_NewWorld', 'PC_Thief', 'WP_MIDDLE',
    ));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
    expect(screen.queryByTestId('world-armed-cancel')).toBeNull();
  });

  it('is prefilled with the selected waypoint', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-waynet-toggle'));
    fireEvent.click(screen.getByTestId('stub-pick-waypoint'));
    fireEvent.click(screen.getByTestId('world-add-npc'));
    await screen.findByTestId('world-insert-npc-dialog');

    expect(waypointField().value).toBe('WP_MIDDLE');
    expect(waypointField()).toBeDisabled();
  });
});

describe('Add waypoint… from the toolbar', () => {
  it('turns the overlay on, takes the name first and the ground click second', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-add-waypoint-toolbar'));
    await screen.findByTestId('world-waypoint-add-dialog');
    expect(mockShowWaynet).toBe(true);
    expect(screen.getByRole('dialog')).toHaveTextContent(/next click the ground/i);

    fireEvent.change(screen.getByTestId('world-waypoint-add-name'), { target: { value: 'FP_BENCH' } });
    fireEvent.click(screen.getByTestId('world-waypoint-add-confirm'));
    expect(api.applyWorldOps).not.toHaveBeenCalled();
    expect(hint()).toHaveTextContent('FP_BENCH');

    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledWith([
      expect.objectContaining({ op: 'AddWaypoint', name: 'FP_BENCH', to: TERRAIN }),
    ]));
  });
});

describe('the status bar after a ground click', () => {
  it('offers Add waypoint and Insert NPC with the overlay off, and switches it on when used', async () => {
    // The two used to appear only with Waynet already on — a precondition
    // nothing on screen stated. Using either now turns the overlay on itself,
    // since the result is a waypoint and only the overlay draws one.
    await openWorld();
    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    act(() => useWorldStore.getState().selectVob(null));

    expect(await screen.findByTestId('world-add-waypoint')).toBeInTheDocument();
    expect(screen.getByTestId('world-insert-npc')).toBeInTheDocument();
    expect(mockShowWaynet).toBe(false);

    fireEvent.click(screen.getByTestId('world-add-waypoint'));
    await screen.findByTestId('world-waypoint-add-dialog');
    expect(mockShowWaynet).toBe(true);
  });
});
