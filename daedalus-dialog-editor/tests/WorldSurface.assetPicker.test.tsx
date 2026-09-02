import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { WorldOp } from 'zen-world';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';
import * as mockWorldViewport from './worldViewportMocks';
import WorldSurface from '../src/renderer/components/world/WorldSurface';

/**
 * The Assets panel as a picker (level-editor.md §16.26 row 1): a previewed
 * mesh feeds the two write paths a visual has — `SetVobProp`'s `visual` for
 * the selection, and the place-a-VOB dialog's visual field. Only the viewport
 * is stubbed; the preview's own canvas is jsdom's, so Three is the stand-in
 * every viewport spec uses.
 */

jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());

jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

const TERRAIN: [number, number, number] = [100, 0, 200];

jest.mock('../src/renderer/components/world/WorldViewport', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    __esModule: true,
    default: ReactActual.forwardRef((props: {
      onPick: (vob: number | null, point: [number, number, number] | null, additive: boolean) => void;
    }, ref: React.Ref<{
      raycastDown: () => null; frameVob: () => void; framePoint: () => void;
    }>) => {
      ReactActual.useImperativeHandle(ref, () => ({
        raycastDown: () => null, frameVob: () => undefined, framePoint: () => undefined,
      }));
      return (
        <div data-testid="world-viewport-stub">
          <button type="button" data-testid="stub-pick-terrain" onClick={() => props.onPick(null, TERRAIN, false)}>
            pick terrain
          </button>
        </div>
      );
    }),
  };
});

const api = makeWorldEditorApi();

async function openWorld() {
  const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]) };
  api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
  api.openWorld.mockResolvedValueOnce(summary as never);
  api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
  api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
  render(<WorldSurface />);
  fireEvent.click(screen.getByTestId('world-open'));
  await screen.findByTestId('world-viewport-stub');
  return summary;
}

/** Walk the Assets tab to a crate and preview it. */
async function previewCrate() {
  api.listWorldAssets.mockResolvedValue([{ name: 'NW_CRATE.MRM', type: 'file' }] as never);
  fireEvent.click(screen.getByTestId('world-panel-assets'));
  fireEvent.click(await screen.findByTestId('world-asset-NW_CRATE.MRM'));
  await screen.findByTestId('world-asset-preview-name');
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  api.getWorldHistoryDepth.mockResolvedValue({ undo: 0, redo: 0 } as never);
  api.getVobProps.mockResolvedValue({ class: 'zCVob', presetName: '', visualCamAlign: 0, bias: 0 } as never);
  api.getVobFolders.mockResolvedValue({ folders: [] } as never);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
});

afterEach(() => {
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
});

describe('the Assets panel as a picker', () => {
  it('writes the previewed mesh as the visual of every selected VOB, in one batch', async () => {
    await openWorld();
    act(() => {
      useWorldStore.getState().selectVob(0);
      useWorldStore.getState().toggleVob(1);
    });
    await previewCrate();

    fireEvent.click(await screen.findByTestId('world-asset-use-visual'));

    // The same path the property grid's visual field takes: one `SetVobProp`
    // per selected VOB, `from` read out of the index, and the box refitted
    // only when the new visual resolves — here it does not, so no box moves.
    await waitFor(() => expect(api.applyWorldOps).toHaveBeenCalledTimes(1));
    const [ops] = api.applyWorldOps.mock.calls[0] as unknown as [WorldOp[]];
    expect(ops).toEqual([0, 1].map((vob) => ({
      op: 'SetVobProp',
      vob,
      path: String(vob),
      from: { visual: 'BARREL.3DS' },
      to: { visual: 'NW_CRATE.MRM' },
      fromBbox: null,
      toBbox: null,
    })));
    expect(api.getVisualBounds).toHaveBeenCalledWith('NW_CRATE.MRM');
  });

  it('offers nothing to write when no VOB is selected', async () => {
    await openWorld();
    act(() => useWorldStore.getState().selectVob(null));
    await previewCrate();

    expect(await screen.findByTestId('world-asset-use-visual')).toBeDisabled();
    expect(api.applyWorldOps).not.toHaveBeenCalled();
  });

  it('prefills the place-a-VOB dialog with the previewed mesh', async () => {
    await openWorld();
    await previewCrate();
    // The previewed asset outlives the tab: the placement bar lives beside
    // the scene, so the gesture is preview, switch, click the ground, place.
    fireEvent.click(screen.getByTestId('world-panel-scene'));
    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    act(() => useWorldStore.getState().selectVob(null));
    fireEvent.click(await screen.findByTestId('world-place-vob'));

    const usePreviewed = screen.getByTestId('world-place-use-previewed');
    expect(usePreviewed).toBeEnabled();
    fireEvent.click(usePreviewed);

    expect(screen.getByTestId('world-place-visual')).toHaveValue('NW_CRATE.MRM');
  });

  it('has nothing to prefill from when nothing is previewed', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('stub-pick-terrain'));
    act(() => useWorldStore.getState().selectVob(null));
    fireEvent.click(await screen.findByTestId('world-place-vob'));

    expect(screen.getByTestId('world-place-use-previewed')).toBeDisabled();
  });
});
