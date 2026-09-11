import React, { useEffect, useMemo, useState } from 'react';
import { Box, List, ListItemButton, ListItemText, TextField, Typography } from '@mui/material';
import type { AssetCatalog, VfsEntry } from '../../../shared/worldTypes';
import type { AssetThumbnails } from '../../world/assetThumbnails';
import WorldAssetGrid, { type AssetPlacement, type TileCatalogActions } from './WorldAssetGrid';

// Favorites and categories on the asset browser (level-editor.md §16.26,
// "Wanted on top") — two views over the merged catalogue (vobbilder's seed
// plus the project's `<project>.assets.json`), drawn with the same tiles as
// the directory grid. A category's tiles ask for a visual by the name the
// catalogue stores — a seed entry's `.3DS` source name, a filed entry's
// compiled name — and the binding resolves either.
//
// Both views carry a text filter (§16.37 row 3). Unlike the browser's, which
// is the current directory only because a listing costs a VFS call, the whole
// catalogue is already in memory — so at the category list the filter matches
// a **visual** as well as a path, and names the category holding it. That is
// the case the first outside user hit: `NW_NATURE_GRASSGROUP_01.3DS` is filed
// under *Pflanzen*, and nothing about the word "Pflanzen" says so.

export interface WorldAssetCatalogViewProps {
  mode: 'favorites' | 'categories';
  catalog: AssetCatalog;
  thumbnails: AssetThumbnails;
  actions: TileCatalogActions;
  /** Whether `name` under `path` is the project's own entry, and so removable. */
  removable: (path: string, name: string) => boolean;
  onRemoveFromCategory: (path: string, name: string) => void;
  onPreview: (name: string) => void;
  /** Placing from a tile (§16.37 row 4) — absent with no world open. */
  placement?: AssetPlacement;
}

const asEntries = (names: readonly string[]): VfsEntry[] => names.map((name) => ({ name, type: 'file' }));

const matching = (names: readonly string[], needle: string): readonly string[] => (
  needle === '' ? names : names.filter((name) => name.toLowerCase().includes(needle))
);

const WorldAssetCatalogView: React.FC<WorldAssetCatalogViewProps> = ({
  mode, catalog, thumbnails, actions, removable, onRemoveFromCategory, onPreview, placement,
}) => {
  const [selected, setSelected] = useState<string | null>(null);
  const category = catalog.categories.find((entry) => entry.path === selected) ?? null;
  // Reset on the view change, not on stepping into a category: the filter is
  // how you found the category, so it has to survive the step that follows it.
  // Favorites and categories are different corpora, and a filter carried
  // between them would silently empty the one you just opened.
  const [filter, setFilter] = useState('');
  useEffect(() => { setFilter(''); }, [mode]);
  const needle = filter.trim().toLowerCase();

  // A category left behind takes its queued draws with it, as a directory does.
  useEffect(() => { thumbnails.cancelPending(); }, [thumbnails, selected, mode]);

  const entries = useMemo(
    () => asEntries(matching(mode === 'favorites' ? catalog.favorites : category?.visuals ?? [], needle)),
    [mode, catalog.favorites, category, needle],
  );
  // A category survives the filter when its own path matches or it holds a
  // visual that does; the count then says how much of it did, because "32
  // visuals" over a list showing one is the number nobody can trust.
  const categories = useMemo(() => catalog.categories.map((entry) => ({
    entry,
    matched: entry.path.toLowerCase().includes(needle) ? entry.visuals.length : matching(entry.visuals, needle).length,
  })).filter(({ matched }) => needle === '' || matched > 0), [catalog.categories, needle]);

  const field = (
    <Box sx={{ px: 0.5, py: 0.25, borderBottom: 1, borderColor: 'divider' }}>
      <TextField
        size="small"
        variant="outlined"
        fullWidth
        placeholder={mode === 'favorites' ? 'Filter favorites' : 'Filter categories and visuals'}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        inputProps={{
          'data-testid': 'world-asset-catalog-filter',
          'aria-label': mode === 'favorites' ? 'Filter favorites' : 'Filter categories and visuals',
        }}
        sx={{ '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
      />
    </Box>
  );
  const noMatches = (
    <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }} data-testid="world-asset-catalog-filter-empty">
      No matches for this filter.
    </Typography>
  );
  const onOpen = (entry: VfsEntry) => onPreview(entry.name);
  const tileActions = useMemo<TileCatalogActions>(() => (
    mode === 'categories' && category !== null
      ? {
        ...actions,
        onUnfile: undefined,
      }
      : actions
  ), [mode, category, actions]);

  if (mode === 'favorites') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {field}
        {/* Having no favorites at all and having filtered them all away are
            different answers, and only the first one is worth advice. */}
        {catalog.favorites.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }} data-testid="world-asset-favorites-empty">
            No favorites yet — star a tile in the directory grid.
          </Typography>
        )}
        {catalog.favorites.length > 0 && entries.length === 0 && noMatches}
        {entries.length > 0 && (
          <Box sx={{ flex: 1, minHeight: 0 }} role="list" aria-label="Favorite assets">
            <WorldAssetGrid entries={entries} thumbnails={thumbnails} onOpen={onOpen} actions={actions} placement={placement} />
          </Box>
        )}
      </Box>
    );
  }

  if (category === null) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {field}
        {categories.length === 0 && noMatches}
        <List dense disablePadding sx={{ overflowY: 'auto', flex: 1, minHeight: 0 }} aria-label="Asset categories">
          {categories.map(({ entry, matched }) => (
            <ListItemButton
              key={entry.path}
              dense
              data-testid={`world-asset-category-${entry.path}`}
              onClick={() => setSelected(entry.path)}
              sx={{ py: 0.25 }}
            >
              <ListItemText
                primary={entry.path}
                secondary={matched === entry.visuals.length
                  ? `${entry.visuals.length.toLocaleString()} visuals`
                  : `${matched.toLocaleString()} of ${entry.visuals.length.toLocaleString()} visuals`}
                primaryTypographyProps={{ variant: 'caption', noWrap: true }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderBottom: 1, borderColor: 'divider' }}>
        <Typography
          variant="caption"
          component="button"
          onClick={() => setSelected(null)}
          data-testid="world-asset-category-back"
          sx={{ background: 'none', border: 0, p: 0, cursor: 'pointer', color: 'text.secondary', font: 'inherit' }}
        >
          ‹ Categories
        </Typography>
        <Typography variant="caption" noWrap sx={{ flex: 1 }}>{category.path}</Typography>
      </Box>
      {field}
      {entries.length === 0 && noMatches}
      <Box sx={{ flex: 1, minHeight: 0 }} role="list" aria-label={`Assets in ${category.path}`}>
        <CategoryGrid
          entries={entries}
          thumbnails={thumbnails}
          onOpen={onOpen}
          actions={tileActions}
          path={category.path}
          removable={removable}
          onRemoveFromCategory={onRemoveFromCategory}
          placement={placement}
        />
      </Box>
    </Box>
  );
};

/** The grid of one category: a tile the project filed gets an unfile
 *  action; a seed entry does not. Per tile, so the actions object is built
 *  once per (category, name) rather than once for the grid. */
const CategoryGrid: React.FC<{
  entries: VfsEntry[]; thumbnails: AssetThumbnails; onOpen: (entry: VfsEntry) => void;
  actions: TileCatalogActions; path: string;
  removable: (path: string, name: string) => boolean;
  onRemoveFromCategory: (path: string, name: string) => void;
  placement?: AssetPlacement;
}> = ({ entries, thumbnails, onOpen, actions, path, removable, onRemoveFromCategory, placement }) => {
  const withUnfile = useMemo<TileCatalogActions>(() => ({
    ...actions,
    onUnfile: (name) => { if (removable(path, name)) onRemoveFromCategory(path, name); },
  }), [actions, path, removable, onRemoveFromCategory]);
  // The grid takes one actions object for every tile; whether a given tile
  // shows the unfile button is decided by the tile from `removable`, which is
  // why the action itself re-checks it.
  const perTile = useMemo(() => ({ ...withUnfile, removable: (name: string) => removable(path, name) }), [withUnfile, removable, path]);
  return <WorldAssetGrid entries={entries} thumbnails={thumbnails} onOpen={onOpen} actions={perTile} placement={placement} />;
};

export default WorldAssetCatalogView;
