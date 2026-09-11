/**
 * The asset browser over the mounted VFS (level-editor.md §6).
 *
 * What it browses is not a filesystem: `openVfs` mounts the retail VDFs and any
 * mod sources into **one namespace**, later sources winning, which is the load
 * order ZenGin itself uses. So a path here is a position in that namespace, and
 * the browser never touches disk.
 *
 * The rules it has to hold, all of them measured (`zenkit-node/README.md`):
 *
 *   - one level at a time, never a recursive walk. A Gothic install is tens of
 *     thousands of entries.
 *   - a listing of null means "nothing here to list" — a missing path and a
 *     file are the same answer, and neither is an error to report.
 *   - a VOB names its *source* asset while the VFS holds what the compiler
 *     produced, so the names here are `.MRM`/`.MDL`/`-C.TEX`, not `.3DS`.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VfsEntry } from '../src/shared/worldTypes';
import type { AssetThumbnails, ThumbnailState } from '../src/renderer/world/assetThumbnails';
import WorldAssetBrowser, { type AssetCatalogProps } from '../src/renderer/components/world/WorldAssetBrowser';
import { LiveTileContext } from '../src/renderer/components/world/WorldAssetGrid';
import type { LiveTilePreview } from '../src/renderer/world/LiveTilePreview';
import { THUMBNAIL_SIZE } from '../src/renderer/world/ThumbnailRenderer';

/** The live render, stubbed: what it draws is `LiveTilePreview.test.ts`'s
 *  business, and what the tile owes it is which name, which host and when. */
function livePreview() {
  return {
    show: jest.fn(async () => {}),
    hide: jest.fn(),
    beginDrag: jest.fn(),
    drag: jest.fn(),
    endDrag: jest.fn(),
  } as unknown as jest.Mocked<LiveTilePreview>;
}

jest.mock('react-virtualized-auto-sizer', () => (props: {
  children: (size: { height: number; width: number }) => React.ReactNode;
}) => props.children({ height: 600, width: 320 }));

const TREE: Record<string, VfsEntry[] | null> = {
  // The file is listed FIRST on purpose. `vfsList` returns the VFS's own set
  // order, in which files and directories are interleaved by name, so a
  // fixture that already had the directories first would agree with an
  // unsorted browser and prove nothing.
  '/': [
    { name: 'MOD_ONLY.MRM', type: 'file' },
    { name: 'Meshes', type: 'directory' },
    { name: 'Textures', type: 'directory' },
  ],
  'Meshes': [
    { name: '_compiled', type: 'directory' },
  ],
  'Meshes/_compiled': [
    { name: 'NW_CRATE.MRM', type: 'file' },
    { name: 'CHESTBIG.MDL', type: 'file' },
  ],
  'Textures': [
    { name: 'NW_WOOD-C.TEX', type: 'file' },
  ],
};

function listing() {
  const calls: string[] = [];
  const list = jest.fn(async (path: string) => {
    calls.push(path);
    return TREE[path] ?? null;
  });
  return { list, calls };
}

/** The whole-namespace search, stubbed over the same fixture tree: every entry
 *  at every depth whose name contains the needle, with the directory it was
 *  found in — which is what `vfsFind` answers and what a listing cannot. */
function searching() {
  const queries: string[] = [];
  const search = jest.fn(async (query: string) => {
    queries.push(query);
    const needle = query.trim().toLowerCase();
    const matches = Object.entries(TREE).flatMap(([directory, entries]) => (entries ?? [])
      .filter((entry) => entry.name.toLowerCase().includes(needle))
      .map((entry) => ({ ...entry, directory })));
    // Directories first, as the binding orders them.
    matches.sort((a, b) => (a.type === b.type ? 0 : a.type === 'directory' ? -1 : 1));
    return { matches, truncated: false };
  });
  return { search, queries };
}

/** The thumbnail queue, stubbed: what it draws is the renderer's business,
 *  and what a tile owes it is which name and when. */
function thumbnails(states: Record<string, ThumbnailState> = {}) {
  const listeners = new Set<() => void>();
  const store = new Map(Object.entries(states));
  return {
    queue: {
      get: (name: string) => store.get(name),
      request: jest.fn(),
      redraw: jest.fn(),
      cancelPending: jest.fn(),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    } as unknown as AssetThumbnails,
    deliver(name: string, state: ThumbnailState) {
      store.set(name, state);
      for (const listener of listeners) listener();
    },
  };
}

describe('WorldAssetBrowser', () => {
  it('lists the root of the mounted namespace on open', async () => {
    const { list, calls } = listing();
    render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

    await screen.findByTestId('world-asset-Meshes');
    expect(screen.getByTestId('world-asset-MOD_ONLY.MRM')).toBeInTheDocument();
    expect(calls).toEqual(['/']);
  });

  it('opens a row from the keyboard, so the list can be walked without a mouse', async () => {
    // §5.4 item 17 of `docs/plans/level-editor-review-2026-09-04.md`. A row was
    // a `div` with an `onClick` and no `tabIndex`: nothing in the browser could
    // be reached, let alone activated, without a pointer.
    const { list } = listing();
    const onPreview = jest.fn();
    render(<WorldAssetBrowser listAssets={list} onPreview={onPreview} />);

    const row = await screen.findByTestId('world-asset-MOD_ONLY.MRM');
    expect(row).toHaveAttribute('tabindex', '0');

    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onPreview).toHaveBeenCalledWith('MOD_ONLY.MRM');
  });

  it('marks the row whose asset is being previewed', async () => {
    // §5.4 item 17's other half. Nothing on a row said which of them the panel
    // beside it was showing, so a preview and the list disagreed silently.
    const { list } = listing();
    render(
      <WorldAssetBrowser
        listAssets={list}
        onPreview={jest.fn()}
        previewing="MOD_ONLY.MRM"
      />,
    );

    const row = await screen.findByTestId('world-asset-MOD_ONLY.MRM');
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('world-asset-Meshes')).not.toHaveAttribute('aria-current');
  });

  it('descends one directory at a time, asking only for the one opened', async () => {
    // Never a recursive walk: the install is tens of thousands of entries.
    const user = userEvent.setup();
    const { list, calls } = listing();
    render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

    await user.click(await screen.findByTestId('world-asset-Meshes'));
    await screen.findByTestId('world-asset-_compiled');

    await user.click(screen.getByTestId('world-asset-_compiled'));
    await screen.findByTestId('world-asset-NW_CRATE.MRM');

    expect(calls).toEqual(['/', 'Meshes', 'Meshes/_compiled']);
  });

  it('shows where it is, and can go back up', async () => {
    const user = userEvent.setup();
    const { list } = listing();
    render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

    await user.click(await screen.findByTestId('world-asset-Meshes'));
    await user.click(await screen.findByTestId('world-asset-_compiled'));
    expect(screen.getByTestId('world-asset-crumb-Meshes-_compiled')).toHaveTextContent('_compiled');

    await user.click(screen.getByTestId('world-asset-up'));
    await screen.findByTestId('world-asset-_compiled');
    expect(screen.getByTestId('world-asset-crumb-Meshes')).toHaveTextContent('Meshes');
  });

  it('cannot go up from the root', async () => {
    const { list } = listing();
    render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

    await screen.findByTestId('world-asset-Meshes');
    expect(screen.getByTestId('world-asset-up')).toBeDisabled();
  });

  it('asks to preview a file, and never a directory', async () => {
    const user = userEvent.setup();
    const { list } = listing();
    const onPreview = jest.fn();
    render(<WorldAssetBrowser listAssets={list} onPreview={onPreview} />);

    await user.click(await screen.findByTestId('world-asset-Meshes'));
    await user.click(await screen.findByTestId('world-asset-_compiled'));
    await user.click(screen.getByTestId('world-asset-NW_CRATE.MRM'));

    expect(onPreview).toHaveBeenCalledWith('Meshes/_compiled/NW_CRATE.MRM');
    // Descending is what a directory click does; it is not a preview.
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it('reports an empty directory as empty rather than as a failure', async () => {
    // `vfsList` answers null for a path that is not there *and* for a file.
    // Both mean nothing to list, and neither is an error worth alarming about.
    const list = jest.fn(async () => null);
    render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

    await screen.findByTestId('world-asset-empty');
    expect(screen.queryByTestId('world-asset-error')).not.toBeInTheDocument();
  });

  it('does not claim a directory is empty before it has been listed', async () => {
    // "Nothing here" and "not listed yet" look identical, and collapsing them
    // makes every directory flash as empty on the way in — and makes the empty
    // state one nobody can trust. Found by a sabotage that should have failed
    // the test above and did not: it was passing on the very first frame,
    // before the listing had arrived at all.
    let deliver: (entries: VfsEntry[] | null) => void = () => {};
    const list = jest.fn(() => new Promise<VfsEntry[] | null>((resolve) => { deliver = resolve; }));
    render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

    expect(screen.queryByTestId('world-asset-empty')).not.toBeInTheDocument();

    deliver(null);
    await screen.findByTestId('world-asset-empty');
  });

  it('surfaces a refused listing instead of showing an empty directory', async () => {
    // "No world is open" is a real failure and must not read as "no assets".
    const list = jest.fn(async () => { throw new Error('No world is open'); });
    render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('world-asset-error')).toHaveTextContent(/No world is open/));
    expect(screen.queryByTestId('world-asset-empty')).not.toBeInTheDocument();
  });

  it('shows directories before files, so descending is not a hunt', async () => {
    const { list } = listing();
    render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

    await screen.findByTestId('world-asset-Meshes');
    // Scoped to the row list — the breadcrumb above it is its own `<ol>`
    // and contributes `listitem`s of its own now.
    const rowList = screen.getByRole('list', { name: 'Mounted assets' });
    const names = within(rowList).getAllByRole('listitem').map((row) => row.getAttribute('data-testid'));
    expect(names).toEqual([
      'world-asset-Meshes', 'world-asset-Textures', 'world-asset-MOD_ONLY.MRM',
    ]);
  });

  // The source facet (architecture level-editor.md §6, #237). `openVfs` mounts the
  // retail VDFs, a mod's archives and any loose `_compiled` tree into one
  // namespace, later sources winning, and until now the browser could not say
  // which of them a name came from — an overridden retail file is simply gone
  // from the merged tree. `vfsList` now annotates each entry with the mounts
  // that hold it, as indices into the mount list.
  describe('the source facet', () => {
    const MOUNTS = [
      'C:/Gothic II/Data/Textures.vdf',
      'C:/Gothic II/_work/Data/Meshes/_compiled',
      'D:/mods/Chronicles/Chronicles.vdf',
    ];

    const MIXED: Record<string, VfsEntry[] | null> = {
      '/': [
        { name: 'RETAIL.TEX', type: 'file', sources: [0] },
        { name: 'SHARED.TEX', type: 'file', sources: [0, 2] },
        { name: 'MOD.MRM', type: 'file', sources: [2] },
        { name: 'LOOSE.MRM', type: 'file', sources: [1] },
        { name: 'Meshes', type: 'directory', sources: [1, 2] },
      ],
    };

    function mixed() {
      return jest.fn(async (path: string) => MIXED[path] ?? null);
    }

    const rowNames = () => within(screen.getByRole('list', { name: 'Mounted assets' }))
      .getAllByRole('listitem')
      .map((row) => row.getAttribute('data-testid'));

    it('names the mount each entry is served from', async () => {
      render(<WorldAssetBrowser listAssets={mixed()} onPreview={jest.fn()} sources={MOUNTS} />);
      await screen.findByTestId('world-asset-RETAIL.TEX');

      expect(screen.getByTestId('world-asset-origin-RETAIL.TEX')).toHaveTextContent('Textures.vdf');
      // A loose tree's own name is `_compiled` in three different places, so
      // the directory above it is part of the name or the label says nothing.
      expect(screen.getByTestId('world-asset-origin-LOOSE.MRM')).toHaveTextContent('Meshes/_compiled');
      // Held by two, and the one shown is the one the merged namespace serves:
      // the last, not the first.
      expect(screen.getByTestId('world-asset-origin-SHARED.TEX')).toHaveTextContent('Chronicles.vdf');
    });

    it('narrows the listing to one mount', async () => {
      const user = userEvent.setup();
      render(<WorldAssetBrowser listAssets={mixed()} onPreview={jest.fn()} sources={MOUNTS} />);
      await screen.findByTestId('world-asset-RETAIL.TEX');

      await user.selectOptions(screen.getByTestId('world-asset-source'), '2');

      // Everything the mod holds, including what it only shadows, and nothing
      // it does not.
      expect(rowNames()).toEqual([
        'world-asset-Meshes', 'world-asset-SHARED.TEX', 'world-asset-MOD.MRM',
      ]);
    });

    it('shades an entry a later mount overrides, and only there', async () => {
      const user = userEvent.setup();
      render(<WorldAssetBrowser listAssets={mixed()} onPreview={jest.fn()} sources={MOUNTS} />);
      await screen.findByTestId('world-asset-RETAIL.TEX');

      // Merged, `SHARED.TEX` is not overridden — it *is* the mod's copy.
      expect(screen.getByTestId('world-asset-SHARED.TEX')).not.toHaveAttribute('data-overridden');

      await user.selectOptions(screen.getByTestId('world-asset-source'), '0');
      expect(screen.getByTestId('world-asset-SHARED.TEX')).toHaveAttribute('data-overridden', 'true');
      expect(screen.getByTestId('world-asset-RETAIL.TEX')).not.toHaveAttribute('data-overridden');
    });

    it('counts what the source filter left, like the text filter does', async () => {
      const user = userEvent.setup();
      render(<WorldAssetBrowser listAssets={mixed()} onPreview={jest.fn()} sources={MOUNTS} />);
      await screen.findByTestId('world-asset-RETAIL.TEX');

      await user.selectOptions(screen.getByTestId('world-asset-source'), '2');
      expect(screen.getByTestId('world-asset-count')).toHaveTextContent('3 of 5');
    });

    it('offers no facet when there is only one mount, or none', async () => {
      const { rerender } = render(
        <WorldAssetBrowser listAssets={mixed()} onPreview={jest.fn()} sources={['C:/Gothic II/Data/Textures.vdf']} />,
      );
      await screen.findByTestId('world-asset-RETAIL.TEX');
      expect(screen.queryByTestId('world-asset-source')).not.toBeInTheDocument();

      rerender(<WorldAssetBrowser listAssets={mixed()} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-RETAIL.TEX');
      expect(screen.queryByTestId('world-asset-source')).not.toBeInTheDocument();
      // And without a mount list there is nothing to name a row with either.
      expect(screen.queryByTestId('world-asset-origin-RETAIL.TEX')).not.toBeInTheDocument();
    });

    it('names the mount on a tile too, and shades an overridden one', async () => {
      // The grid is the same listing, so the same question is answerable in
      // it — a badge over the thumbnail rather than a column, because a tile
      // is 96 px and its height is fixed by the virtualised grid.
      const user = userEvent.setup();
      const { queue } = thumbnails();
      render(
        <WorldAssetBrowser listAssets={mixed()} onPreview={jest.fn()} thumbnails={queue} sources={MOUNTS} />,
      );
      await screen.findByTestId('world-asset-RETAIL.TEX');
      await user.click(screen.getByTestId('world-asset-view-grid'));

      const tile = screen.getByTestId('world-asset-tile-RETAIL.TEX');
      expect(within(tile).getByTestId('world-asset-tile-origin')).toHaveTextContent('Textures.vdf');
      expect(tile).not.toHaveAttribute('data-overridden');

      await user.selectOptions(screen.getByTestId('world-asset-source'), '0');
      expect(screen.getByTestId('world-asset-tile-SHARED.TEX')).toHaveAttribute('data-overridden', 'true');
    });

    it('keeps the chosen mount across a navigation, unlike the text filter', async () => {
      // The facet is a lens on the whole install; the text filter is about the
      // directory in front of you, which is why that one resets.
      const user = userEvent.setup();
      const list = jest.fn(async (path: string) => (path === '/' ? MIXED['/'] : [
        { name: 'DEEP.MRM', type: 'file' as const, sources: [1] },
        { name: 'DEEP_MOD.MRM', type: 'file' as const, sources: [2] },
      ]));
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} sources={MOUNTS} />);
      await screen.findByTestId('world-asset-RETAIL.TEX');

      await user.selectOptions(screen.getByTestId('world-asset-source'), '2');
      await user.click(screen.getByTestId('world-asset-Meshes'));

      await screen.findByTestId('world-asset-DEEP_MOD.MRM');
      expect(screen.queryByTestId('world-asset-DEEP.MRM')).not.toBeInTheDocument();
    });
  });

  // The filter (level-editor.md §17) — the current
  // directory only, the same "one level at a time" rule the listing
  // itself already holds.
  describe('the filter', () => {
    it('narrows the current directory case-insensitively', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.type(screen.getByTestId('world-asset-filter'), 'mesh');

      expect(screen.getByTestId('world-asset-Meshes')).toBeInTheDocument();
      expect(screen.queryByTestId('world-asset-Textures')).not.toBeInTheDocument();
      expect(screen.queryByTestId('world-asset-MOD_ONLY.MRM')).not.toBeInTheDocument();
    });

    it('reports how many entries match, out of how many are in this directory', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');
      expect(screen.getByTestId('world-asset-count')).toHaveTextContent('3 entries');

      await user.type(screen.getByTestId('world-asset-filter'), 'mesh');

      expect(screen.getByTestId('world-asset-count')).toHaveTextContent('1 of 3');
    });

    it('says so when nothing in this directory matches, rather than showing an empty list', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.type(screen.getByTestId('world-asset-filter'), 'nothing matches this');

      expect(await screen.findByTestId('world-asset-filter-empty')).toBeInTheDocument();
      // Distinct from the directory actually being empty.
      expect(screen.queryByTestId('world-asset-empty')).not.toBeInTheDocument();
    });

    // Without `searchAssets` the box is the directory filter it always was —
    // the browser harness has no mounted VFS to search.
    it('stays the directory filter when no search is wired in', async () => {
      const { list } = listing();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');

      expect(screen.getByTestId('world-asset-filter')).toHaveAttribute('aria-label', 'Filter this directory');
    });

    it('resets on navigation, rather than hiding everything in the next directory', async () => {
      // A filter that still matches "Meshes" itself, so the row survives to
      // be clicked — "_compiled" would not match "mesh" and must not stay
      // hidden by a filter typed one directory up.
      const user = userEvent.setup();
      const { list } = listing();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.type(screen.getByTestId('world-asset-filter'), 'mesh');
      await user.click(screen.getByTestId('world-asset-Meshes'));

      expect(await screen.findByTestId('world-asset-_compiled')).toBeInTheDocument();
      expect(screen.getByTestId('world-asset-filter')).toHaveValue('');
    });
  });

  // The thumbnail grid (level-editor.md §16.26 row 1) — the same listing as
  // tiles, each asking the queue for its picture as it comes on screen.
  describe('the grid', () => {
    it('is not offered without a queue to draw from', async () => {
      const { list } = listing();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');
      expect(screen.queryByTestId('world-asset-view-grid')).not.toBeInTheDocument();
    });

    it('shows the listing as tiles, directories first, and previews a file on click', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const onPreview = jest.fn();
      const { queue } = thumbnails();
      render(<WorldAssetBrowser listAssets={list} onPreview={onPreview} thumbnails={queue} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.click(screen.getByTestId('world-asset-view-grid'));

      const tiles = screen.getAllByTestId(/^world-asset-tile-/).map((tile) => tile.getAttribute('data-testid'));
      expect(tiles).toEqual(['world-asset-tile-Meshes', 'world-asset-tile-Textures', 'world-asset-tile-MOD_ONLY.MRM']);
      expect(screen.queryByTestId('world-asset-Meshes')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('world-asset-tile-MOD_ONLY.MRM'));
      expect(onPreview).toHaveBeenCalledWith('MOD_ONLY.MRM');

      await user.click(screen.getByTestId('world-asset-tile-Meshes'));
      await screen.findByTestId('world-asset-tile-_compiled');
    });

    it('asks the queue for each file tile, shows a placeholder until it answers, then the picture', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const { queue, deliver } = thumbnails();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue} />);
      await screen.findByTestId('world-asset-Meshes');
      await user.click(screen.getByTestId('world-asset-view-grid'));

      expect(queue.request).toHaveBeenCalledWith('MOD_ONLY.MRM');
      // A directory has no thumbnail and must not be asked for one.
      expect(queue.request).not.toHaveBeenCalledWith('Meshes');
      expect(within(screen.getByTestId('world-asset-tile-MOD_ONLY.MRM')).getByTestId('world-asset-thumb-pending')).toBeInTheDocument();

      act(() => deliver('MOD_ONLY.MRM', { status: 'ready', dataUrl: 'data:image/png;base64,AAAA' }));

      const image = within(screen.getByTestId('world-asset-tile-MOD_ONLY.MRM')).getByRole('img');
      expect(image).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    });

    it('marks a tile the binding could not draw, rather than leaving it pending forever', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const { queue } = thumbnails({ 'MOD_ONLY.MRM': { status: 'failed' } });
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue} />);
      await screen.findByTestId('world-asset-Meshes');
      await user.click(screen.getByTestId('world-asset-view-grid'));

      expect(within(screen.getByTestId('world-asset-tile-MOD_ONLY.MRM')).getByTestId('world-asset-thumb-failed')).toBeInTheDocument();
    });

    it('drops the queued draws when the listing moves on, and can redraw the ones on screen', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const { queue } = thumbnails();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue} />);
      await screen.findByTestId('world-asset-Meshes');
      await user.click(screen.getByTestId('world-asset-view-grid'));

      await user.click(screen.getByTestId('world-asset-tile-Meshes'));
      await screen.findByTestId('world-asset-tile-_compiled');
      expect(queue.cancelPending).toHaveBeenCalled();

      await user.click(screen.getByTestId('world-asset-tile-_compiled'));
      await screen.findByTestId('world-asset-tile-NW_CRATE.MRM');
      await user.click(screen.getByTestId('world-asset-redraw'));
      expect(queue.redraw).toHaveBeenCalledWith('NW_CRATE.MRM');
      expect(queue.redraw).toHaveBeenCalledWith('CHESTBIG.MDL');
    });

    // The hovered tile comes alive (level-editor.md §16.26 row 1): the still
    // is a frame of a scene, and the pointer is what makes it turn.
    it('turns the mesh tile under the pointer, and takes the render back on the way out', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const { queue } = thumbnails();
      const live = livePreview();
      render(
        <LiveTileContext.Provider value={live}>
          <WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue} />
        </LiveTileContext.Provider>,
      );
      await screen.findByTestId('world-asset-Meshes');
      await user.click(screen.getByTestId('world-asset-view-grid'));

      const tile = screen.getByTestId('world-asset-tile-MOD_ONLY.MRM');
      const thumb = within(tile).getByTestId('world-asset-thumb-pending');
      await user.hover(thumb);
      expect(live.show).toHaveBeenCalledWith('MOD_ONLY.MRM', thumb, THUMBNAIL_SIZE);

      await user.unhover(thumb);
      expect(live.hide).toHaveBeenCalledWith(thumb);
    });

    it('leaves a directory and a texture alone — neither has geometry to turn', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const { queue } = thumbnails();
      const live = livePreview();
      render(
        <LiveTileContext.Provider value={live}>
          <WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue} />
        </LiveTileContext.Provider>,
      );
      await screen.findByTestId('world-asset-Meshes');
      await user.click(screen.getByTestId('world-asset-view-grid'));

      await user.hover(screen.getByTestId('world-asset-tile-Textures'));
      await user.click(screen.getByTestId('world-asset-tile-Textures'));
      const texture = await screen.findByTestId('world-asset-tile-NW_WOOD-C.TEX');
      await user.hover(within(texture).getByTestId('world-asset-thumb-pending'));

      expect(live.show).not.toHaveBeenCalled();
    });

    it('a drag turns the tile instead of opening it', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const { queue } = thumbnails();
      const live = livePreview();
      const onPreview = jest.fn();
      render(
        <LiveTileContext.Provider value={live}>
          <WorldAssetBrowser listAssets={list} onPreview={onPreview} thumbnails={queue} />
        </LiveTileContext.Provider>,
      );
      await screen.findByTestId('world-asset-Meshes');
      await user.click(screen.getByTestId('world-asset-view-grid'));

      const tile = screen.getByTestId('world-asset-tile-MOD_ONLY.MRM');
      const thumb = within(tile).getByTestId('world-asset-thumb-pending');
      await user.hover(thumb);
      // A `MouseEvent` under the pointer type, as the viewport suites do it:
      // jsdom implements no `PointerEvent`, and `fireEvent.pointerDown`
      // silently drops the button and the coordinates it is given.
      const press = { bubbles: true, button: 0, clientX: 10, clientY: 10 };
      fireEvent(thumb, new MouseEvent('pointerdown', press));
      fireEvent(thumb, new MouseEvent('pointermove', { ...press, clientX: 40, clientY: 14 }));
      fireEvent(thumb, new MouseEvent('pointerup', { ...press, clientX: 40, clientY: 14 }));

      expect(live.beginDrag).toHaveBeenCalled();
      expect(live.drag).toHaveBeenCalledWith(30, 4);
      expect(live.endDrag).toHaveBeenCalled();
      // The click the drag ends with is the drag's, not the tile's.
      fireEvent.click(thumb);
      expect(onPreview).not.toHaveBeenCalled();

      // A plain click still opens the file.
      await user.click(tile);
      expect(onPreview).toHaveBeenCalledWith('MOD_ONLY.MRM');
    });

    it('goes back to the list', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const { queue } = thumbnails();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue} />);
      await screen.findByTestId('world-asset-Meshes');
      await user.click(screen.getByTestId('world-asset-view-grid'));
      await user.click(screen.getByTestId('world-asset-view-list'));
      expect(screen.getByTestId('world-asset-Meshes')).toBeInTheDocument();
    });
  });

  // Favorites and categories (level-editor.md §16.26, "Wanted on top") — a
  // second and third way into the same tiles, over the project sidecar
  // merged with the vobbilder seed.
  describe('favorites and categories', () => {
    function catalogProps(overrides: Partial<AssetCatalogProps> = {}): AssetCatalogProps {
      return {
        catalog: {
          favorites: ['NW_BARREL.3DS'],
          categories: [
            { path: 'Items/Schwerter', visuals: ['ITMW_SWORD.3DS'] },
            { path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] },
          ],
        },
        removable: (path, name) => path === 'Mine/Crates' && name === 'NW_CRATE.MRM',
        onToggleFavorite: jest.fn(),
        onAddToCategory: jest.fn(),
        onRemoveFromCategory: jest.fn(),
        ...overrides,
      };
    }
    const queue = () => ({
      get: () => undefined, request: jest.fn(), redraw: jest.fn(), cancelPending: jest.fn(),
      subscribe: () => () => {},
    }) as unknown as AssetThumbnails;

    it('offers the two views only with a catalogue', async () => {
      const { list } = listing();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue()} />);
      await screen.findByTestId('world-asset-Meshes');
      expect(screen.queryByTestId('world-asset-mode-favorites')).not.toBeInTheDocument();
    });

    it('lists the favorites as tiles and previews one on click', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const onPreview = jest.fn();
      render(<WorldAssetBrowser listAssets={list} onPreview={onPreview} thumbnails={queue()} catalog={catalogProps()} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.click(screen.getByTestId('world-asset-mode-favorites'));

      expect(screen.getByTestId('world-asset-tile-NW_BARREL.3DS')).toBeInTheDocument();
      expect(screen.queryByTestId('world-asset-Meshes')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('world-asset-tile-NW_BARREL.3DS'));
      expect(onPreview).toHaveBeenCalledWith('NW_BARREL.3DS');
    });

    it('stars a tile from the directory grid, and reads the star off the catalogue by key', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const props = catalogProps({ catalog: { favorites: ['MOD_ONLY.3DS'], categories: [] } });
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue()} catalog={props} />);
      await screen.findByTestId('world-asset-Meshes');
      await user.click(screen.getByTestId('world-asset-view-grid'));

      // `MOD_ONLY.MRM` is the compiled name of the favourite `MOD_ONLY.3DS`.
      const star = within(screen.getByTestId('world-asset-tile-MOD_ONLY.MRM')).getByTestId('world-asset-star');
      expect(star).toHaveAttribute('aria-pressed', 'true');
      await user.click(star);
      expect(props.onToggleFavorite).toHaveBeenCalledWith('MOD_ONLY.MRM');
    });

    it('lists the categories, shows the chosen one as tiles, and can drop a visual the project filed', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const props = catalogProps();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue()} catalog={props} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.click(screen.getByTestId('world-asset-mode-categories'));
      expect(screen.getByTestId('world-asset-category-Items/Schwerter')).toBeInTheDocument();
      await user.click(screen.getByTestId('world-asset-category-Mine/Crates'));

      const tile = screen.getByTestId('world-asset-tile-NW_CRATE.MRM');
      expect(screen.queryByTestId('world-asset-tile-ITMW_SWORD.3DS')).not.toBeInTheDocument();
      await user.click(within(tile).getByTestId('world-asset-unfile'));
      expect(props.onRemoveFromCategory).toHaveBeenCalledWith('Mine/Crates', 'NW_CRATE.MRM');

      // A seed entry is not the project's to drop.
      await user.click(screen.getByTestId('world-asset-category-back'));
      await user.click(screen.getByTestId('world-asset-category-Items/Schwerter'));
      expect(within(screen.getByTestId('world-asset-tile-ITMW_SWORD.3DS')).queryByTestId('world-asset-unfile')).not.toBeInTheDocument();
    });

    // The star on a row (level-editor.md §16.37 row 2; #242). It lived only on
    // a grid tile, revealed on hover, and the panel opens in list view — so the
    // Favorites tab was reachable, always empty, and unfillable from anything
    // on screen.
    it('stars a file from the list row, which is the view the panel opens in', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const props = catalogProps({ catalog: { favorites: ['MOD_ONLY.3DS'], categories: [] } });
      const onPreview = jest.fn();
      render(<WorldAssetBrowser listAssets={list} onPreview={onPreview} thumbnails={queue()} catalog={props} />);
      await screen.findByTestId('world-asset-MOD_ONLY.MRM');

      // `MOD_ONLY.3DS` is the source name of the compiled `MOD_ONLY.MRM`.
      const star = within(screen.getByTestId('world-asset-MOD_ONLY.MRM')).getByTestId('world-asset-star');
      expect(star).toHaveAttribute('aria-pressed', 'true');
      await user.click(star);

      expect(props.onToggleFavorite).toHaveBeenCalledWith('MOD_ONLY.MRM');
      // The row opens a file on click, and the star sits inside the row.
      expect(onPreview).not.toHaveBeenCalled();
    });

    it('puts no star on a directory row, nor on any row without a catalogue', async () => {
      const { list } = listing();
      const { unmount } = render(
        <WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue()} catalog={catalogProps()} />,
      );
      await screen.findByTestId('world-asset-Meshes');
      expect(within(screen.getByTestId('world-asset-Meshes')).queryByTestId('world-asset-star')).not.toBeInTheDocument();
      unmount();

      render(<WorldAssetBrowser listAssets={listing().list} onPreview={jest.fn()} thumbnails={queue()} />);
      await screen.findByTestId('world-asset-MOD_ONLY.MRM');
      expect(within(screen.getByTestId('world-asset-MOD_ONLY.MRM')).queryByTestId('world-asset-star')).not.toBeInTheDocument();
    });

    // The catalogue filter (level-editor.md §16.37 row 3; #243). The seed
    // ships 1,396 visuals over 32 categories and neither list had a text
    // field, so an asset you know the name of could only be found by
    // scrolling — which is how a present asset reads as missing.
    describe('the catalogue filter', () => {
      const pflanzen: AssetCatalogProps = {
        catalog: {
          favorites: ['NW_BARREL.3DS', 'ITMW_SWORD.3DS'],
          categories: [
            { path: 'Pflanzen', visuals: ['NW_NATURE_GRASSGROUP_01.3DS', 'NW_NATURE_BUSH_01.3DS'] },
            { path: 'Items/Schwerter', visuals: ['ITMW_SWORD.3DS'] },
          ],
        },
        removable: () => false,
        onToggleFavorite: jest.fn(),
        onAddToCategory: jest.fn(),
        onRemoveFromCategory: jest.fn(),
      };

      async function categories() {
        const user = userEvent.setup();
        const { list } = listing();
        render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue()} catalog={pflanzen} />);
        await screen.findByTestId('world-asset-Meshes');
        await user.click(screen.getByTestId('world-asset-mode-categories'));
        return user;
      }

      it('finds the category holding a visual named nowhere in its path', async () => {
        const user = await categories();

        await user.type(screen.getByTestId('world-asset-catalog-filter'), 'grassgroup');

        // Nothing about "Pflanzen" matches "grassgroup" — the visual inside it does.
        expect(screen.getByTestId('world-asset-category-Pflanzen')).toBeInTheDocument();
        expect(screen.queryByTestId('world-asset-category-Items/Schwerter')).not.toBeInTheDocument();
        // And it says how much of the category matched, so the count is not a lie.
        expect(screen.getByTestId('world-asset-category-Pflanzen')).toHaveTextContent('1 of 2 visuals');
      });

      it('carries the filter into the category, so the match is what is on screen', async () => {
        const user = await categories();
        await user.type(screen.getByTestId('world-asset-catalog-filter'), 'grassgroup');

        await user.click(screen.getByTestId('world-asset-category-Pflanzen'));

        expect(screen.getByTestId('world-asset-tile-NW_NATURE_GRASSGROUP_01.3DS')).toBeInTheDocument();
        expect(screen.queryByTestId('world-asset-tile-NW_NATURE_BUSH_01.3DS')).not.toBeInTheDocument();
      });

      it('narrows the category list by path too, case-insensitively', async () => {
        const user = await categories();

        await user.type(screen.getByTestId('world-asset-catalog-filter'), 'schwert');

        expect(screen.getByTestId('world-asset-category-Items/Schwerter')).toBeInTheDocument();
        expect(screen.queryByTestId('world-asset-category-Pflanzen')).not.toBeInTheDocument();
      });

      it('narrows the favorites grid as well', async () => {
        const user = userEvent.setup();
        const { list } = listing();
        render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue()} catalog={pflanzen} />);
        await screen.findByTestId('world-asset-Meshes');
        await user.click(screen.getByTestId('world-asset-mode-favorites'));

        await user.type(screen.getByTestId('world-asset-catalog-filter'), 'sword');

        expect(screen.getByTestId('world-asset-tile-ITMW_SWORD.3DS')).toBeInTheDocument();
        expect(screen.queryByTestId('world-asset-tile-NW_BARREL.3DS')).not.toBeInTheDocument();
      });

      it('says nothing matched rather than showing an empty list', async () => {
        const user = await categories();

        await user.type(screen.getByTestId('world-asset-catalog-filter'), 'zzzz');

        expect(screen.getByTestId('world-asset-catalog-filter-empty')).toBeInTheDocument();
        expect(screen.queryByTestId('world-asset-category-Pflanzen')).not.toBeInTheDocument();
      });

      it('resets when the other catalogue view is chosen, which is a different corpus', async () => {
        const user = await categories();
        await user.type(screen.getByTestId('world-asset-catalog-filter'), 'grassgroup');

        await user.click(screen.getByTestId('world-asset-mode-favorites'));

        expect(screen.getByTestId('world-asset-catalog-filter')).toHaveValue('');
        expect(screen.getByTestId('world-asset-tile-NW_BARREL.3DS')).toBeInTheDocument();
      });
    });

    it('files a tile into an existing category, or a new one, from its menu', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const props = catalogProps();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} thumbnails={queue()} catalog={props} />);
      await screen.findByTestId('world-asset-Meshes');
      await user.click(screen.getByTestId('world-asset-view-grid'));

      await user.click(within(screen.getByTestId('world-asset-tile-MOD_ONLY.MRM')).getByTestId('world-asset-file'));
      await user.click(await screen.findByTestId('world-asset-file-into-Items/Schwerter'));
      expect(props.onAddToCategory).toHaveBeenCalledWith('Items/Schwerter', 'MOD_ONLY.MRM');

      await user.click(within(screen.getByTestId('world-asset-tile-MOD_ONLY.MRM')).getByTestId('world-asset-file'));
      await user.type(await screen.findByTestId('world-asset-file-new'), 'Mine/Barrels{Enter}');
      expect(props.onAddToCategory).toHaveBeenCalledWith('Mine/Barrels', 'MOD_ONLY.MRM');
    });
  });

  // Placing from the tile (level-editor.md §16.37 row 4; #244). The verb
  // existed, on the far side of the viewport in the panel that otherwise shows
  // the selected VOB's properties, and reads as being about that VOB. Here it
  // is where the pointer already is.
  describe('placing from an asset', () => {
    const queue = () => ({
      get: () => undefined, request: jest.fn(), redraw: jest.fn(), cancelPending: jest.fn(),
      subscribe: () => () => {},
    }) as unknown as AssetThumbnails;
    const catalog = {
      catalog: { favorites: [], categories: [{ path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] }] },
      removable: () => false,
      onToggleFavorite: jest.fn(),
      onAddToCategory: jest.fn(),
      onRemoveFromCategory: jest.fn(),
    };
    /** A stand-in for `isPlaceableVisual`: a mesh is placeable, a texture is not. */
    const placement = () => ({
      canPlace: (name: string) => /\.(MRM|3DS)$/i.test(name),
      onPlace: jest.fn(),
    });

    it('places a category tile from its context menu', async () => {
      const user = userEvent.setup();
      const place = placement();
      render(
        <WorldAssetBrowser
          listAssets={listing().list} onPreview={jest.fn()} thumbnails={queue()}
          catalog={catalog} placement={place}
        />,
      );
      await screen.findByTestId('world-asset-Meshes');
      await user.click(screen.getByTestId('world-asset-mode-categories'));
      await user.click(screen.getByTestId('world-asset-category-Mine/Crates'));

      fireEvent.contextMenu(screen.getByTestId('world-asset-tile-NW_CRATE.MRM'));
      await user.click(await screen.findByTestId('world-asset-place-menu'));

      expect(place.onPlace).toHaveBeenCalledWith('NW_CRATE.MRM');
    });

    it('places a browse row too, which is the view the panel opens in', async () => {
      const user = userEvent.setup();
      const place = placement();
      render(
        <WorldAssetBrowser
          listAssets={listing().list} onPreview={jest.fn()} thumbnails={queue()} placement={place}
        />,
      );
      await screen.findByTestId('world-asset-MOD_ONLY.MRM');

      fireEvent.contextMenu(screen.getByTestId('world-asset-MOD_ONLY.MRM'));
      await user.click(await screen.findByTestId('world-asset-place-menu'));

      expect(place.onPlace).toHaveBeenCalledWith('MOD_ONLY.MRM');
    });

    it('offers nothing for a directory, or for a name no mesh can be made of', async () => {
      const user = userEvent.setup();
      const place = placement();
      render(
        <WorldAssetBrowser
          listAssets={listing().list} onPreview={jest.fn()} thumbnails={queue()} placement={place}
        />,
      );
      await screen.findByTestId('world-asset-Meshes');

      fireEvent.contextMenu(screen.getByTestId('world-asset-Meshes'));
      expect(screen.queryByTestId('world-asset-place-menu')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('world-asset-Textures'));
      fireEvent.contextMenu(await screen.findByTestId('world-asset-NW_WOOD-C.TEX'));
      expect(screen.queryByTestId('world-asset-place-menu')).not.toBeInTheDocument();
    });

    it('offers nothing at all where there is no world to place into', async () => {
      render(<WorldAssetBrowser listAssets={listing().list} onPreview={jest.fn()} thumbnails={queue()} />);
      await screen.findByTestId('world-asset-MOD_ONLY.MRM');

      fireEvent.contextMenu(screen.getByTestId('world-asset-MOD_ONLY.MRM'));
      expect(screen.queryByTestId('world-asset-place-menu')).not.toBeInTheDocument();
    });
  });

  // The breadcrumbs (level-editor.md §17) — one segment
  // per path component, replacing the static path caption.
  describe('the breadcrumbs', () => {
    it('shows just the root at the top level', async () => {
      const { list } = listing();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

      await screen.findByTestId('world-asset-Meshes');
      expect(screen.getByTestId('world-asset-crumb-root')).toHaveTextContent('/');
    });

    it('adds one segment per directory descended into', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

      await user.click(await screen.findByTestId('world-asset-Meshes'));
      await user.click(await screen.findByTestId('world-asset-_compiled'));

      expect(screen.getByTestId('world-asset-crumb-root')).toBeInTheDocument();
      expect(screen.getByTestId('world-asset-crumb-Meshes')).toHaveTextContent('Meshes');
      expect(screen.getByTestId('world-asset-crumb-Meshes-_compiled')).toHaveTextContent('_compiled');
    });

    it('jumps back to a prefix in one click', async () => {
      const user = userEvent.setup();
      const { list, calls } = listing();
      render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);
      await user.click(await screen.findByTestId('world-asset-Meshes'));
      await user.click(await screen.findByTestId('world-asset-_compiled'));
      await screen.findByTestId('world-asset-NW_CRATE.MRM');

      await user.click(screen.getByTestId('world-asset-crumb-root'));

      await screen.findByTestId('world-asset-Meshes');
      expect(calls).toEqual(['/', 'Meshes', 'Meshes/_compiled', '/']);
    });
  });

  // The whole-namespace search (#241; level-editor.md §16.37 row 1). The
  // directory-only filter is what made an asset that IS mounted read as
  // missing: the one thing a modder knows is the name, and the one thing they
  // do not is which of tens of thousands of directories holds it.
  describe('the search', () => {
    it('finds a file in a directory the browser is not standing in', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const { search } = searching();
      render(<WorldAssetBrowser listAssets={list} searchAssets={search} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');
      // Nothing at the root is called NW_CRATE.MRM; it is two levels down.
      expect(screen.queryByTestId('world-asset-NW_CRATE.MRM')).not.toBeInTheDocument();

      await user.type(screen.getByTestId('world-asset-filter'), 'crate');

      expect(await screen.findByTestId('world-asset-NW_CRATE.MRM')).toBeInTheDocument();
      expect(search).toHaveBeenCalledWith('crate');
    });

    it('says where a hit lives, since that is the thing that was missing', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const { search } = searching();
      render(<WorldAssetBrowser listAssets={list} searchAssets={search} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.type(screen.getByTestId('world-asset-filter'), 'crate');

      expect(await screen.findByTestId('world-asset-where-NW_CRATE.MRM'))
        .toHaveTextContent('Meshes/_compiled');
    });

    it('previews a hit at its own path, not at the path being browsed', async () => {
      const user = userEvent.setup();
      const onPreview = jest.fn();
      const { list } = listing();
      const { search } = searching();
      render(<WorldAssetBrowser listAssets={list} searchAssets={search} onPreview={onPreview} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.type(screen.getByTestId('world-asset-filter'), 'crate');
      await user.click(await screen.findByTestId('world-asset-NW_CRATE.MRM'));

      expect(onPreview).toHaveBeenCalledWith('Meshes/_compiled/NW_CRATE.MRM');
    });

    it('descends into a directory hit at its own path', async () => {
      const user = userEvent.setup();
      const { list, calls } = listing();
      const { search } = searching();
      render(<WorldAssetBrowser listAssets={list} searchAssets={search} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.type(screen.getByTestId('world-asset-filter'), 'compiled');
      await user.click(await screen.findByTestId('world-asset-_compiled'));

      expect(await screen.findByTestId('world-asset-NW_CRATE.MRM')).toBeInTheDocument();
      expect(calls).toContain('Meshes/_compiled');
      // The needle is spent: the directory it led to is what is wanted now.
      expect(screen.getByTestId('world-asset-filter')).toHaveValue('');
    });

    it('walks the namespace once, after the typing stops', async () => {
      // Every keystroke would otherwise walk tens of thousands of entries, and
      // only the walk after the last letter was ever wanted.
      const user = userEvent.setup();
      const { list } = listing();
      const { search, queries } = searching();
      render(<WorldAssetBrowser listAssets={list} searchAssets={search} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.type(screen.getByTestId('world-asset-filter'), 'crate');
      await screen.findByTestId('world-asset-NW_CRATE.MRM');

      expect(queries).toEqual(['crate']);
    });

    it('counts the matches, and says when the walk was cut short', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const search = jest.fn(async () => ({
        matches: [{ name: 'NW_CRATE.MRM', type: 'file' as const, directory: 'Meshes/_compiled' }],
        truncated: true,
      }));
      render(<WorldAssetBrowser listAssets={list} searchAssets={search} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.type(screen.getByTestId('world-asset-filter'), 'e');

      // "first", because the number is not how many there are.
      expect(await screen.findByTestId('world-asset-count')).toHaveTextContent('first 1 matches');
    });

    it('says nothing anywhere matches, rather than showing an empty list', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const { search } = searching();
      render(<WorldAssetBrowser listAssets={list} searchAssets={search} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.type(screen.getByTestId('world-asset-filter'), 'zzzz');

      const empty = await screen.findByTestId('world-asset-filter-empty');
      expect(empty).toHaveTextContent('Nothing in the mounted assets matches.');
      // Distinct from the directory being empty, which it is not.
      expect(screen.queryByTestId('world-asset-empty')).not.toBeInTheDocument();
    });

    it('reports a refused search as a failure, not as "nothing matches"', async () => {
      const user = userEvent.setup();
      const { list } = listing();
      const search = jest.fn(async () => { throw new Error('No world is open'); });
      render(<WorldAssetBrowser listAssets={list} searchAssets={search} onPreview={jest.fn()} />);
      await screen.findByTestId('world-asset-Meshes');

      await user.type(screen.getByTestId('world-asset-filter'), 'crate');

      expect(await screen.findByTestId('world-asset-error')).toHaveTextContent('No world is open');
      expect(screen.queryByTestId('world-asset-filter-empty')).not.toBeInTheDocument();
    });
  });
});
