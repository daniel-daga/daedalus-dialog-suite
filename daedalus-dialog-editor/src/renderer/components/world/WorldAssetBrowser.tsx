import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Breadcrumbs, IconButton, Link, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import FolderIcon from '@mui/icons-material/Folder';
import GridViewIcon from '@mui/icons-material/GridView';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewListIcon from '@mui/icons-material/ViewList';
import { FixedSizeList as List, type ListChildComponentProps, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { isFavorite } from 'zen-world';
import type { AssetCatalog, VfsEntry } from '../../../shared/worldTypes';
import type { AssetThumbnails } from '../../world/assetThumbnails';
import WorldAssetGrid, { type TileCatalogActions } from './WorldAssetGrid';
import WorldAssetCatalogView from './WorldAssetCatalogView';

// The asset browser over the mounted VFS (level-editor.md §6).
//
// What it browses is not a filesystem. `openVfs` mounts the retail VDFs and any
// mod sources into ONE namespace, later sources winning — the load order ZenGin
// itself uses — so a path here is a position in that namespace and nothing here
// ever touches disk.
//
// Three rules, all of them from the measured behaviour of `vfsList`:
//
//   - **one level at a time.** A Gothic install is tens of thousands of
//     entries; a recursive walk would hand this component the whole tree to
//     show one directory.
//   - **null means "nothing here to list".** `vfsList` answers null for a path
//     that is not there and for a file alike, and neither is an error.
//   - **the names are the compiled ones.** A VOB names its source asset
//     (`.3DS`, `.ASC`, `.TGA`); the VFS holds what the asset compiler produced
//     (`.MRM`, `.MDL`, `-C.TEX`). This shows the latter, because that is what
//     is actually there.

const ROW_HEIGHT = 26;

interface RowData {
  entries: VfsEntry[];
  onOpen: (entry: VfsEntry) => void;
}

const Row = memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const entry = data.entries[index];
  const isDirectory = entry.type === 'directory';

  return (
    <Box
      role="listitem"
      data-testid={`world-asset-${entry.name}`}
      onClick={() => data.onOpen(entry)}
      style={style}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, px: 1, cursor: 'pointer',
        whiteSpace: 'nowrap', '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {isDirectory
        ? <FolderIcon fontSize="small" sx={{ color: 'text.secondary', fontSize: 16 }} />
        : <InsertDriveFileOutlinedIcon sx={{ color: 'text.disabled', fontSize: 16 }} />}
      <Typography variant="caption" noWrap>{entry.name}</Typography>
    </Box>
  );
}, areEqual);
Row.displayName = 'WorldAssetRow';

export interface WorldAssetBrowserProps {
  listAssets: (path: string) => Promise<VfsEntry[] | null>;
  /** A file was chosen — the full path inside the mounted namespace. */
  onPreview: (path: string) => void;
  /** The thumbnail queue (level-editor.md §16.26 row 1). Absent, there is no
   *  grid view to offer — the browser harness has no world to draw from. */
  thumbnails?: AssetThumbnails;
  /** Favorites and categories (§16.26, "Wanted on top"). Absent — no project
   *  sidecar loaded — the browser is the directory walk alone. */
  catalog?: AssetCatalogProps;
}

export interface AssetCatalogProps {
  /** The merged view: the shipped seed plus the project's own sidecar. */
  catalog: AssetCatalog;
  /** Whether `name` under `path` is the project's own entry, and so removable. */
  removable: (path: string, name: string) => boolean;
  onToggleFavorite: (name: string) => void;
  onAddToCategory: (path: string, name: string) => void;
  onRemoveFromCategory: (path: string, name: string) => void;
}

const WorldAssetBrowser: React.FC<WorldAssetBrowserProps> = ({ listAssets, onPreview, thumbnails, catalog }) => {
  const [path, setPath] = useState('/');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [mode, setMode] = useState<'browse' | 'favorites' | 'categories'>('browse');
  const tileActions = useMemo<TileCatalogActions | undefined>(() => (
    catalog === undefined ? undefined : {
      isFavorite: (name) => isFavorite(catalog.catalog, name),
      onToggleFavorite: catalog.onToggleFavorite,
      categoryPaths: catalog.catalog.categories.map((category) => category.path),
      onAddToCategory: catalog.onAddToCategory,
    }
  ), [catalog]);
  // Three states, not two. "Nothing here" and "not listed yet" look identical
  // and are not the same thing: collapsing them makes every directory flash as
  // empty on the way in, and makes an empty state that can never be trusted.
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; entries: VfsEntry[] } | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    listAssets(path)
      // Null is "nothing here to list" — `vfsList` answers it for a missing
      // path and for a file alike, and neither is an error.
      .then((listed) => { if (current) setState({ status: 'ready', entries: listed ?? [] }); })
      // A refused listing ("No world is open") is a failure and must not read
      // as an empty directory.
      .catch((failure: unknown) => {
        if (!current) return;
        setState({
          status: 'error',
          message: failure instanceof Error ? failure.message : String(failure),
        });
      });
    return () => { current = false; };
  }, [listAssets, path]);

  // Directories first: descending is the common action, and a directory buried
  // among a few hundred files is a hunt.
  const sorted = useMemo(() => {
    if (state.status !== 'ready') return [];
    return [...state.entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return 0;
    });
  }, [state]);

  // The filter (level-editor.md §17) — the current
  // directory only, never a walk of the whole namespace: the same "one
  // level at a time" rule the browser already holds for the listing
  // itself. Reset on navigation, so a filter typed two directories ago
  // does not silently hide everything in this one.
  const [filter, setFilter] = useState('');
  useEffect(() => { setFilter(''); }, [path]);
  // A directory left behind takes its queued draws with it: the tiles that
  // asked are gone, and the next directory's tiles should not wait behind
  // them.
  useEffect(() => { thumbnails?.cancelPending(); }, [thumbnails, path]);
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle === '' ? sorted : sorted.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [sorted, filter]);

  const onOpen = useCallback((entry: VfsEntry) => {
    const child = path === '/' ? entry.name : `${path}/${entry.name}`;
    if (entry.type === 'directory') setPath(child);
    else onPreview(child);
  }, [path, onPreview]);

  const goUp = useCallback(() => {
    setPath((current) => {
      const at = current.lastIndexOf('/');
      return at <= 0 ? '/' : current.slice(0, at);
    });
  }, []);

  /** The path as breadcrumb segments — the root first, always, then one
   *  per path component with the path it navigates to. Keyed and
   *  identified by that cumulative path rather than the bare name: two
   *  directories sharing a name at different depths are a real position
   *  in the VFS namespace and must not collide. */
  const crumbs = useMemo(() => {
    const parts = path === '/' ? [] : path.split('/').filter((part) => part !== '');
    const segments: Array<{ name: string; path: string }> = [{ name: '/', path: '/' }];
    let at = '';
    for (const part of parts) {
      at = at === '' ? part : `${at}/${part}`;
      segments.push({ name: part, path: at });
    }
    return segments;
  }, [path]);

  const itemData = useMemo<RowData>(() => ({ entries: filtered, onOpen }), [filtered, onOpen]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {catalog !== undefined && thumbnails !== undefined && (
        <ToggleButtonGroup
          size="small"
          exclusive
          fullWidth
          value={mode}
          onChange={(_event, next: 'browse' | 'favorites' | 'categories' | null) => { if (next !== null) setMode(next); }}
          sx={{ '& .MuiToggleButton-root': { py: 0.25, fontSize: 11, textTransform: 'none' } }}
        >
          <ToggleButton value="browse" data-testid="world-asset-mode-browse">Browse</ToggleButton>
          <ToggleButton value="favorites" data-testid="world-asset-mode-favorites">Favorites</ToggleButton>
          <ToggleButton value="categories" data-testid="world-asset-mode-categories">Categories</ToggleButton>
        </ToggleButtonGroup>
      )}
      {catalog !== undefined && thumbnails !== undefined && tileActions !== undefined && mode !== 'browse' && (
        <WorldAssetCatalogView
          mode={mode}
          catalog={catalog.catalog}
          thumbnails={thumbnails}
          actions={tileActions}
          removable={catalog.removable}
          onRemoveFromCategory={catalog.onRemoveFromCategory}
          onPreview={onPreview}
        />
      )}
      {mode === 'browse' && (<>
      <Box sx={{
        display: 'flex', flexDirection: 'column', gap: 0.5, px: 0.5, py: 0.25,
        borderBottom: 1, borderColor: 'divider',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Up one directory">
            {/* A span, because a disabled button reports no pointer events and
                MUI's tooltip needs one to attach to. */}
            <span>
              <IconButton
                size="small"
                onClick={goUp}
                disabled={path === '/'}
                data-testid="world-asset-up"
                aria-label="Up one directory"
              >
                <ArrowUpwardIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
          {/* One namespace, not a filesystem — but still a position in it,
              and a breadcrumb per segment is what makes an arbitrary depth
              jumpable in one click rather than one "Up" at a time. */}
          <Breadcrumbs
            aria-label="Position in the mounted namespace"
            sx={{ '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' }, minWidth: 0 }}
          >
            {crumbs.map((crumb, index) => {
              const testId = `world-asset-crumb-${crumb.path === '/' ? 'root' : crumb.path.replace(/\//g, '-')}`;
              return index === crumbs.length - 1
                ? (
                  <Typography
                    key={crumb.path}
                    variant="caption"
                    color="text.primary"
                    noWrap
                    data-testid={testId}
                  >
                    {crumb.name}
                  </Typography>
                )
                : (
                  <Link
                    key={crumb.path}
                    component="button"
                    variant="caption"
                    underline="hover"
                    color="text.secondary"
                    onClick={() => setPath(crumb.path)}
                    data-testid={testId}
                  >
                    {crumb.name}
                  </Link>
                );
            })}
          </Breadcrumbs>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <TextField
            size="small"
            variant="outlined"
            placeholder="Filter this directory"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            inputProps={{ 'data-testid': 'world-asset-filter', 'aria-label': 'Filter this directory' }}
            sx={{ flex: 1, minWidth: 0, '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
          />
          {/* Only once the listing has actually arrived. `sorted` is `[]`
              while loading and on a refusal alike, so an unconditional
              count would assert "0 entries" for a directory nobody has
              heard back about yet — the very flash the three-state
              `state` above exists to prevent. */}
          {state.status === 'ready' && (
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              data-testid="world-asset-count"
            >
              {filter.trim() === ''
                ? `${sorted.length.toLocaleString()} entries`
                : `${filtered.length.toLocaleString()} of ${sorted.length.toLocaleString()}`}
            </Typography>
          )}
          {thumbnails !== undefined && (
            <>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={view}
                onChange={(_event, next: 'list' | 'grid' | null) => { if (next !== null) setView(next); }}
                sx={{ '& .MuiToggleButton-root': { p: 0.25 } }}
              >
                <ToggleButton value="list" data-testid="world-asset-view-list" aria-label="List view">
                  <ViewListIcon sx={{ fontSize: 16 }} />
                </ToggleButton>
                <ToggleButton value="grid" data-testid="world-asset-view-grid" aria-label="Thumbnail grid">
                  <GridViewIcon sx={{ fontSize: 16 }} />
                </ToggleButton>
              </ToggleButtonGroup>
              {view === 'grid' && (
                <Tooltip title="Redraw the thumbnails in this directory">
                  <IconButton
                    size="small"
                    data-testid="world-asset-redraw"
                    aria-label="Redraw thumbnails"
                    onClick={() => { for (const entry of filtered) if (entry.type === 'file') thumbnails.redraw(entry.name); }}
                  >
                    <RefreshIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
            </>
          )}
        </Box>
      </Box>

      {state.status === 'error' && (
        <Typography
          variant="caption"
          color="error"
          data-testid="world-asset-error"
          sx={{ p: 1 }}
        >
          {state.message}
        </Typography>
      )}

      {state.status === 'ready' && sorted.length === 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="world-asset-empty"
          sx={{ p: 1 }}
        >
          Nothing here.
        </Typography>
      )}

      {/* Distinct from the directory being empty: the directory has
          entries, the filter matched none of them. */}
      {state.status === 'ready' && sorted.length > 0 && filtered.length === 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="world-asset-filter-empty"
          sx={{ p: 1 }}
        >
          No matches for this filter.
        </Typography>
      )}

      {state.status === 'ready' && filtered.length > 0 && view === 'grid' && thumbnails !== undefined && (
        <Box sx={{ flex: 1, minHeight: 0 }} role="list" aria-label="Mounted assets">
          <WorldAssetGrid entries={filtered} thumbnails={thumbnails} onOpen={onOpen} actions={tileActions} />
        </Box>
      )}

      {state.status === 'ready' && filtered.length > 0 && (view === 'list' || thumbnails === undefined) && (
        <Box sx={{ flex: 1, minHeight: 0 }} role="list" aria-label="Mounted assets">
          <AutoSizer>
            {({ height, width }) => (
              <List
                height={height}
                width={width}
                itemCount={filtered.length}
                itemSize={ROW_HEIGHT}
                itemData={itemData}
                overscanCount={8}
              >
                {Row}
              </List>
            )}
          </AutoSizer>
        </Box>
      )}
      </>)}
    </Box>
  );
};

export default WorldAssetBrowser;
