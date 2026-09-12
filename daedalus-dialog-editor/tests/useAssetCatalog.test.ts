/**
 * The World surface's asset side, lifted out of `WorldSurface.tsx`
 * (`docs/plans/level-editor-review-2026-09-04.md` §4 — the asset catalogue is
 * one of the nine concerns).
 *
 * `WorldSurface.assetCatalog.test.tsx` already drives the parts a user can see:
 * the sidecar read, the seed merged in, a starred tile written back without the
 * seed, and no verbs at all with no project. What the split makes assertable is
 * the rest of it — everything about *lifetime*, which through the surface needed
 * a mounted viewport and a real GL context:
 *
 *   - which entries `removable` says yes to, and why the seed's are not among them;
 *   - one thumbnail queue and one live tile per **open world**, disposed when the
 *     world changes and again on unmount, and *not* rebuilt for a refreshed index
 *     of the same world, which is the same rule §3.2's fix rests on;
 *   - a sidecar read that lands after the project has changed under it.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAssetCatalog } from '../src/renderer/components/world/hooks/useAssetCatalog';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { SUMMARY } from './worldFixtures';

/** Every renderer built and every one disposed, in order, so a lifetime is a
 *  sequence rather than a count. */
const built: string[] = [];
const disposed: string[] = [];

jest.mock('../src/renderer/world/assetThumbnails', () => ({
  AssetThumbnails: class {
    constructor() { built.push('thumbnails'); }

    dispose() { disposed.push('thumbnails'); }
  },
}));
jest.mock('../src/renderer/world/ThumbnailRenderer', () => ({
  ThumbnailRenderer: class {},
}));
jest.mock('../src/renderer/world/LiveTilePreview', () => ({
  LiveTilePreview: class {
    constructor() { built.push('liveTile'); }

    dispose() { disposed.push('liveTile'); }
  },
}));

const PROJECT = 'C:/mod/mymod.gothicproject.json';
/** A sidecar with one category of its own. `Items/Schwerter` is the shipped
 *  seed's, and is deliberately not in here. */
const SIDECAR = { favorites: ['NW_CRATE.MRM'], categories: [{ path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] }] };

const api = {
  getAssetCatalog: jest.fn(async () => SIDECAR),
  saveAssetCatalog: jest.fn(async () => undefined),
  listWorldAssets: jest.fn(async () => []),
  searchWorldAssets: jest.fn(async () => []),
  getWorldTexture: jest.fn(async () => null),
  getWorldVisual: jest.fn(async () => null),
  getAssetThumbnail: jest.fn(async () => null),
  putAssetThumbnail: jest.fn(async () => undefined),
};

/** A world open at `worldPath`, which is the only thing about a world the
 *  renderers key on. */
function openAt(worldPath: string) {
  useWorldStore.setState({ summary: { ...SUMMARY, worldPath } } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  built.length = 0;
  disposed.length = 0;
  api.getAssetCatalog.mockResolvedValue(SIDECAR);
  (window as unknown as { editorAPI: typeof api }).editorAPI = api;
  useProjectStore.setState({ projectFilePath: PROJECT } as never);
  useWorldStore.setState({ summary: null } as never);
});

describe('useAssetCatalog — the sidecar', () => {
  test('is read for the loaded project, and the seed is merged in for display', async () => {
    const { result } = renderHook(() => useAssetCatalog());
    await waitFor(() => expect(api.getAssetCatalog).toHaveBeenCalledWith(PROJECT));

    const paths = result.current.catalogProps?.catalog.categories.map((c) => c.path) ?? [];
    expect(paths).toContain('Mine/Crates');
    // The shipped seed, which the sidecar does not carry.
    expect(paths).toContain('Items/Schwerter');
  });

  test('with no project there is nowhere to persist to, so no verbs are offered', async () => {
    useProjectStore.setState({ projectFilePath: null } as never);
    const { result } = renderHook(() => useAssetCatalog());
    expect(result.current.catalogProps).toBeUndefined();
    expect(api.getAssetCatalog).not.toHaveBeenCalled();
  });

  test('a change is written back as the project’s own entries, without the seed', async () => {
    const { result } = renderHook(() => useAssetCatalog());
    await waitFor(() => expect(result.current.catalogProps?.catalog.categories.length).toBeGreaterThan(1));

    act(() => { result.current.catalogProps?.onAddToCategory('Mine/Crates', 'NW_BARREL.MRM'); });

    const [, written] = api.saveAssetCatalog.mock.calls[0] as [string, typeof SIDECAR];
    expect(written.categories.map((c) => c.path)).toEqual(['Mine/Crates']);
  });

  test('a read that fails leaves the catalogue empty rather than throwing', async () => {
    const noise = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    api.getAssetCatalog.mockRejectedValueOnce(new Error('EACCES'));
    const { result } = renderHook(() => useAssetCatalog());
    await waitFor(() => expect(noise).toHaveBeenCalled());

    // The seed still shows; the project's own half is simply empty.
    expect(result.current.catalogProps?.catalog.favorites).toEqual([]);
    noise.mockRestore();
  });

  test('a read that lands after the project changed does not overwrite the new one', async () => {
    let settle: (catalog: typeof SIDECAR) => void = () => undefined;
    api.getAssetCatalog.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));

    const { result } = renderHook(() => useAssetCatalog());
    // The project closes while the first read is still out.
    act(() => { useProjectStore.setState({ projectFilePath: null } as never); });
    await act(async () => { settle(SIDECAR); });

    expect(result.current.catalogProps).toBeUndefined();
  });
});

describe('useAssetCatalog — what may be removed from a category', () => {
  test('an entry the sidecar carries is the project’s own, so it is removable', async () => {
    const { result } = renderHook(() => useAssetCatalog());
    await waitFor(() => expect(api.getAssetCatalog).toHaveBeenCalled());
    expect(result.current.catalogProps?.removable('Mine/Crates', 'NW_CRATE.MRM')).toBe(true);
  });

  test('an entry only the seed carries is not — there is nothing to remove it from', async () => {
    const { result } = renderHook(() => useAssetCatalog());
    await waitFor(() => expect(result.current.catalogProps?.catalog.categories.length).toBeGreaterThan(1));

    const seeded = result.current.catalogProps?.catalog.categories
      .find((category) => category.path === 'Items/Schwerter');
    expect(seeded?.visuals.length).toBeGreaterThan(0);
    expect(result.current.catalogProps?.removable('Items/Schwerter', seeded!.visuals[0])).toBe(false);
  });

  test('an entry in no category is not removable from one', async () => {
    const { result } = renderHook(() => useAssetCatalog());
    await waitFor(() => expect(api.getAssetCatalog).toHaveBeenCalled());
    expect(result.current.catalogProps?.removable('Mine/Crates', 'NOT_THERE.MRM')).toBe(false);
  });
});

describe('useAssetCatalog — the renderers’ lifetime', () => {
  test('with no world open there is neither a queue nor a live tile', () => {
    const { result } = renderHook(() => useAssetCatalog());
    expect(result.current.thumbnails).toBeNull();
    expect(result.current.liveTile).toBeNull();
    expect(built).toEqual([]);
  });

  test('opening a world builds one of each', () => {
    const { result } = renderHook(() => useAssetCatalog());
    act(() => { openAt('C:/g2/Data/Worlds/NEWWORLD.ZEN'); });

    expect(result.current.thumbnails).not.toBeNull();
    expect(result.current.liveTile).not.toBeNull();
    expect(built).toEqual(['thumbnails', 'liveTile']);
  });

  test('a refreshed index for the same world keeps both — the mounts have not changed', () => {
    const { result } = renderHook(() => useAssetCatalog());
    act(() => { openAt('C:/g2/Data/Worlds/NEWWORLD.ZEN'); });
    const queue = result.current.thumbnails;
    const tile = result.current.liveTile;

    // What a structural op leaves behind: the same world, a new summary object.
    act(() => { openAt('C:/g2/Data/Worlds/NEWWORLD.ZEN'); });

    expect(result.current.thumbnails).toBe(queue);
    expect(result.current.liveTile).toBe(tile);
    expect(disposed).toEqual([]);
  });

  test('a different world disposes both and builds new ones — their caches are its mounts', () => {
    const { result } = renderHook(() => useAssetCatalog());
    act(() => { openAt('C:/g2/Data/Worlds/NEWWORLD.ZEN'); });
    const queue = result.current.thumbnails;

    act(() => { openAt('C:/g2/Data/Worlds/OLDWORLD.ZEN'); });

    expect(disposed).toEqual(['thumbnails', 'liveTile']);
    expect(built).toEqual(['thumbnails', 'liveTile', 'thumbnails', 'liveTile']);
    expect(result.current.thumbnails).not.toBe(queue);
  });

  test('unmounting gives the GL contexts back', () => {
    const { unmount } = renderHook(() => useAssetCatalog());
    act(() => { openAt('C:/g2/Data/Worlds/NEWWORLD.ZEN'); });
    expect(disposed).toEqual([]);

    unmount();
    expect(disposed).toEqual(['thumbnails', 'liveTile']);
  });
});

describe('useAssetCatalog — the reads it passes through', () => {
  test('each one is the IPC call and nothing else, and stays identity-stable', async () => {
    const { result, rerender } = renderHook(() => useAssetCatalog());
    const before = result.current.listAssets;

    await act(async () => { await result.current.listAssets('Meshes'); });
    await act(async () => { await result.current.searchAssets('crate'); });
    await act(async () => { await result.current.loadTexture('NW_STONE.TEX', 256); });
    await act(async () => { await result.current.loadVisual('NW_CRATE.MRM'); });

    expect(api.listWorldAssets).toHaveBeenCalledWith('Meshes');
    expect(api.searchWorldAssets).toHaveBeenCalledWith('crate');
    expect(api.getWorldTexture).toHaveBeenCalledWith('NW_STONE.TEX', 256);
    expect(api.getWorldVisual).toHaveBeenCalledWith('NW_CRATE.MRM');

    // Stable, which is what keeps the renderers from being rebuilt by a render.
    rerender();
    expect(result.current.listAssets).toBe(before);
  });
});
