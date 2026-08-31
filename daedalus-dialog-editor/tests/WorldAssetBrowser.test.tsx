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
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VfsEntry } from '../src/shared/worldTypes';
import WorldAssetBrowser from '../src/renderer/components/world/WorldAssetBrowser';

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

describe('WorldAssetBrowser', () => {
  it('lists the root of the mounted namespace on open', async () => {
    const { list, calls } = listing();
    render(<WorldAssetBrowser listAssets={list} onPreview={jest.fn()} />);

    await screen.findByTestId('world-asset-Meshes');
    expect(screen.getByTestId('world-asset-MOD_ONLY.MRM')).toBeInTheDocument();
    expect(calls).toEqual(['/']);
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
});
