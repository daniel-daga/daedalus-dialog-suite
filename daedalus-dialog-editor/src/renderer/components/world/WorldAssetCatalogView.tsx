import React, { useEffect, useMemo, useState } from 'react';
import { Box, List, ListItemButton, ListItemText, Typography } from '@mui/material';
import type { AssetCatalog, VfsEntry } from '../../../shared/worldTypes';
import type { AssetThumbnails } from '../../world/assetThumbnails';
import WorldAssetGrid, { type TileCatalogActions } from './WorldAssetGrid';

// Favorites and categories on the asset browser (level-editor.md §16.26,
// "Wanted on top") — two views over the merged catalogue (vobbilder's seed
// plus the project's `<project>.assets.json`), drawn with the same tiles as
// the directory grid. A category's tiles ask for a visual by the name the
// catalogue stores — a seed entry's `.3DS` source name, a filed entry's
// compiled name — and the binding resolves either.

export interface WorldAssetCatalogViewProps {
  mode: 'favorites' | 'categories';
  catalog: AssetCatalog;
  thumbnails: AssetThumbnails;
  actions: TileCatalogActions;
  /** Whether `name` under `path` is the project's own entry, and so removable. */
  removable: (path: string, name: string) => boolean;
  onRemoveFromCategory: (path: string, name: string) => void;
  onPreview: (name: string) => void;
}

const asEntries = (names: readonly string[]): VfsEntry[] => names.map((name) => ({ name, type: 'file' }));

const WorldAssetCatalogView: React.FC<WorldAssetCatalogViewProps> = ({
  mode, catalog, thumbnails, actions, removable, onRemoveFromCategory, onPreview,
}) => {
  const [selected, setSelected] = useState<string | null>(null);
  const category = catalog.categories.find((entry) => entry.path === selected) ?? null;

  // A category left behind takes its queued draws with it, as a directory does.
  useEffect(() => { thumbnails.cancelPending(); }, [thumbnails, selected, mode]);

  const entries = useMemo(
    () => asEntries(mode === 'favorites' ? catalog.favorites : category?.visuals ?? []),
    [mode, catalog.favorites, category],
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
    return entries.length === 0
      ? (
        <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }} data-testid="world-asset-favorites-empty">
          No favorites yet — star a tile in the directory grid.
        </Typography>
      )
      : (
        <Box sx={{ flex: 1, minHeight: 0 }} role="list" aria-label="Favorite assets">
          <WorldAssetGrid entries={entries} thumbnails={thumbnails} onOpen={onOpen} actions={actions} />
        </Box>
      );
  }

  if (category === null) {
    return (
      <List dense disablePadding sx={{ overflowY: 'auto', flex: 1, minHeight: 0 }} aria-label="Asset categories">
        {catalog.categories.map((entry) => (
          <ListItemButton
            key={entry.path}
            dense
            data-testid={`world-asset-category-${entry.path}`}
            onClick={() => setSelected(entry.path)}
            sx={{ py: 0.25 }}
          >
            <ListItemText
              primary={entry.path}
              secondary={`${entry.visuals.length.toLocaleString()} visuals`}
              primaryTypographyProps={{ variant: 'caption', noWrap: true }}
              secondaryTypographyProps={{ variant: 'caption' }}
            />
          </ListItemButton>
        ))}
      </List>
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
      <Box sx={{ flex: 1, minHeight: 0 }} role="list" aria-label={`Assets in ${category.path}`}>
        <CategoryGrid
          entries={entries}
          thumbnails={thumbnails}
          onOpen={onOpen}
          actions={tileActions}
          path={category.path}
          removable={removable}
          onRemoveFromCategory={onRemoveFromCategory}
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
}> = ({ entries, thumbnails, onOpen, actions, path, removable, onRemoveFromCategory }) => {
  const withUnfile = useMemo<TileCatalogActions>(() => ({
    ...actions,
    onUnfile: (name) => { if (removable(path, name)) onRemoveFromCategory(path, name); },
  }), [actions, path, removable, onRemoveFromCategory]);
  // The grid takes one actions object for every tile; whether a given tile
  // shows the unfile button is decided by the tile from `removable`, which is
  // why the action itself re-checks it.
  const perTile = useMemo(() => ({ ...withUnfile, removable: (name: string) => removable(path, name) }), [withUnfile, removable, path]);
  return <WorldAssetGrid entries={entries} thumbnails={thumbnails} onOpen={onOpen} actions={perTile} />;
};

export default WorldAssetCatalogView;
