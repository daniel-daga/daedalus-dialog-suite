import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY, makeWorldEditorApi, vobIndex, waynetPayload } from './worldFixtures';
import * as mockWorldViewport from './worldViewportMocks';
import WorldSurface from '../src/renderer/components/world/WorldSurface';

/**
 * Favorites and categories on the Assets panel (level-editor.md §16.26,
 * "Wanted on top") as the surface wires them: the `<project>.assets.json`
 * sidecar read for the loaded project, the vobbilder seed merged in, and a
 * change written back — the project's own entries only, never the seed.
 */

jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());

jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

jest.mock('../src/renderer/components/world/WorldViewport', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    __esModule: true,
    default: ReactActual.forwardRef((_props: unknown, ref: React.Ref<{
      raycastDown: () => null; frameVob: () => void; framePoint: () => void;
    }>) => {
      ReactActual.useImperativeHandle(ref, () => ({
        raycastDown: () => null, frameVob: () => undefined, framePoint: () => undefined,
      }));
      return <div data-testid="world-viewport-stub" />;
    }),
  };
});

const api = makeWorldEditorApi();
const PROJECT = 'C:/mod/mymod.gothicproject.json';

async function openWorld() {
  const summary = { ...SUMMARY, vobIndex: vobIndex([[0, 0, 0]]) };
  api.openWorldDialog.mockResolvedValueOnce('C:/Gothic/NewWorld.zen' as never);
  api.openWorld.mockResolvedValueOnce(summary as never);
  api.getWorldMesh.mockResolvedValueOnce({ groups: [], bbox: summary.bbox } as never);
  api.getWorldVisuals.mockResolvedValueOnce({ visuals: [], stats: { vobsPlaced: 0 } } as never);
  render(<WorldSurface />);
  fireEvent.click(screen.getByTestId('world-open'));
  // Open world lists the project's worlds (level-editor.md §16.31); these
  // suites want a named file, which is what Browse… still is.
  fireEvent.click(await screen.findByTestId('world-picker-browse'));
  await screen.findByTestId('world-viewport-stub');
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getWorldWaynet.mockResolvedValue(waynetPayload() as never);
  api.getWorldHistoryDepth.mockResolvedValue({ undo: 0, redo: 0 } as never);
  api.getVobFolders.mockResolvedValue({ folders: [] } as never);
  api.getAssetCatalog.mockResolvedValue({ favorites: [], categories: [{ path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] }] } as never);
  api.listWorldAssets.mockResolvedValue([{ name: 'NW_CRATE.MRM', type: 'file' }] as never);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
  useProjectStore.setState({ projectFilePath: PROJECT } as never);
});

afterEach(() => {
  useWorldStore.getState().reset();
  useProjectStore.getState().closeProject();
});

describe('the asset catalog on the surface', () => {
  it('reads the project sidecar, merges the seed in, and shows both as categories', async () => {
    await openWorld();
    expect(api.getAssetCatalog).toHaveBeenCalledWith(PROJECT);

    fireEvent.click(screen.getByTestId('world-panel-assets'));
    fireEvent.click(await screen.findByTestId('world-asset-mode-categories'));

    // A vobbilder category and the project's own, in one list.
    expect(await screen.findByTestId('world-asset-category-Items/Schwerter')).toBeInTheDocument();
    expect(screen.getByTestId('world-asset-category-Mine/Crates')).toBeInTheDocument();
  });

  it('writes a starred tile back to the sidecar as the project’s favorites, without the seed', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-panel-assets'));
    fireEvent.click(await screen.findByTestId('world-asset-view-grid'));
    const tile = await screen.findByTestId('world-asset-tile-NW_CRATE.MRM');

    await act(async () => { fireEvent.click(within(tile).getByTestId('world-asset-star')); });

    await waitFor(() => expect(api.saveAssetCatalog).toHaveBeenCalledWith(PROJECT, {
      favorites: ['NW_CRATE.MRM'],
      categories: [{ path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] }],
    }));
    expect(within(screen.getByTestId('world-asset-tile-NW_CRATE.MRM')).getByTestId('world-asset-star')).toHaveAttribute('aria-pressed', 'true');
  });

  it('writes a category’s collision override to the sidecar, a seed category included (#291)', async () => {
    await openWorld();
    fireEvent.click(screen.getByTestId('world-panel-assets'));
    fireEvent.click(await screen.findByTestId('world-asset-mode-categories'));
    fireEvent.click(await screen.findByTestId('world-asset-category-Pflanzen'));

    await act(async () => {
      fireEvent.change(screen.getByTestId('world-asset-category-collision'), { target: { value: 'on' } });
    });

    // The seed's visuals stay in the seed: the sidecar gets the path and the
    // setting, and nothing it did not write.
    await waitFor(() => expect(api.saveAssetCatalog).toHaveBeenCalledWith(PROJECT, {
      favorites: [],
      categories: [
        { path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] },
        { path: 'Pflanzen', visuals: [], collision: true },
      ],
    }));
    expect(screen.getByTestId('world-asset-category-collision')).toHaveValue('on');
  });

  it('tags a listed mod source that has not been compiled (#294)', async () => {
    // The project root is mounted as it is, so the browser lists a raw `.3DS`
    // — and nothing resolves for it until a GMBT build has compiled it.
    api.listWorldAssets.mockResolvedValue([
      { name: 'KM_VOB_BIG_BUSH_01.3DS', type: 'file' }, { name: 'NW_CRATE.MRM', type: 'file' },
    ] as never);
    api.resolveWorldAssets.mockResolvedValue([null] as never);
    await openWorld();
    fireEvent.click(screen.getByTestId('world-panel-assets'));

    expect(await screen.findByTestId('world-asset-uncompiled-KM_VOB_BIG_BUSH_01.3DS')).toHaveTextContent('not compiled');
    expect(api.resolveWorldAssets).toHaveBeenCalledWith(['KM_VOB_BIG_BUSH_01.3DS']);
  });

  it('files every mesh in a listing into a category with one sidecar write (#295)', async () => {
    api.listWorldAssets.mockResolvedValue([
      { name: 'KM_BUSH_01.MRM', type: 'file' }, { name: 'KM_BUSH_02.MRM', type: 'file' },
      { name: 'NW_CRATE.MRM', type: 'file' },
    ] as never);
    await openWorld();
    fireEvent.click(screen.getByTestId('world-panel-assets'));
    await screen.findByTestId('world-asset-KM_BUSH_01.MRM');

    fireEvent.click(screen.getByTestId('world-asset-file-many'));
    fireEvent.change(await screen.findByTestId('world-asset-file-new'), { target: { value: 'Archolos/Büsche' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('world-asset-file-new'), { key: 'Enter' });
    });

    // Every mesh shown goes in, the crate too — a visual may sit in two
    // categories. One write, and only the project's own: never the seed.
    await waitFor(() => expect(api.saveAssetCatalog).toHaveBeenCalledTimes(1));
    expect(api.saveAssetCatalog).toHaveBeenCalledWith(PROJECT, {
      favorites: [],
      categories: [
        { path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] },
        { path: 'Archolos/Büsche', visuals: ['KM_BUSH_01.MRM', 'KM_BUSH_02.MRM', 'NW_CRATE.MRM'] },
      ],
    });
  });

  it('offers no favorites or categories with no project loaded', async () => {
    useProjectStore.setState({ projectFilePath: null } as never);
    await openWorld();
    fireEvent.click(screen.getByTestId('world-panel-assets'));
    await screen.findByTestId('world-asset-NW_CRATE.MRM');
    expect(api.getAssetCatalog).not.toHaveBeenCalled();
    expect(screen.queryByTestId('world-asset-mode-favorites')).not.toBeInTheDocument();
  });
});
