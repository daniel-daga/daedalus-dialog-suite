import React, { useMemo, useState } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import type { AssetThumbnails } from '../../world/assetThumbnails';
import { searchItemCatalogue, type CatalogueItem } from '../../world/itemCatalogue';
import { Thumbnail } from './WorldAssetGrid';

// The Assets panel's Items tab (#412) — Spacer's Objects window, slice 1: the
// project's item instances by picture and name rather than as a directory of
// files, and a click that arms a placement of one as an `oCItem`.
//
// The pictures come from the same thumbnail queue the grid uses, keyed by the
// visual the item's declaration assigns — an item stores no visual in the world,
// the engine reads it off its script instance (#424). An item whose declaration
// assigns none, or through a constant, gets an empty frame and is placed by
// name, which is the honest answer rather than a faked picture.
//
// Placing is click-then-ground, the surface's armed placement: the row sends the
// instance and the next ground click puts the VOB down, so the same item can be
// placed repeatedly without reopening anything.

/** The tile's picture and its two captions, at the size the item picker uses. */
const TILE = 64;
/** Above this the pictures cost more than the list is worth: each tile asks the
 *  queue on mount, one draw at a time. The container picker caps at the same
 *  number, and the filter is the way past it. */
const MAX_TILES = 400;

export interface WorldItemCatalogueProps {
  items: readonly CatalogueItem[];
  thumbnails: AssetThumbnails;
  /** Arm a placement of `instance` — the `oCItem.instance` the world stores. */
  onPlace: (instance: string) => void;
}

const WorldItemCatalogue: React.FC<WorldItemCatalogueProps> = ({ items, thumbnails, onPlace }) => {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => searchItemCatalogue(items, filter), [items, filter]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ px: 0.5, py: 0.25, borderBottom: 1, borderColor: 'divider' }}>
        <TextField
          size="small"
          variant="outlined"
          placeholder="Search items"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          inputProps={{ 'data-testid': 'world-item-filter', 'aria-label': 'Search items' }}
          sx={{ width: '100%', '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
        />
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        data-testid="world-item-count"
        sx={{ px: 1, py: 0.25 }}
      >
        {shown.length === items.length
          ? `${items.length.toLocaleString()} items`
          : `${shown.length.toLocaleString()} of ${items.length.toLocaleString()}`}
      </Typography>
      {items.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }} data-testid="world-item-empty">
          No item instances in the loaded project.
        </Typography>
      )}
      {items.length > 0 && shown.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }} data-testid="world-item-filter-empty">
          No items match this search.
        </Typography>
      )}
      {shown.length > 0 && (
        <Box
          role="list"
          aria-label="Item instances"
          sx={{
            display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: 0.5, p: 0.5,
            flex: 1, minHeight: 0, overflowY: 'auto',
          }}
        >
          {shown.slice(0, MAX_TILES).map((item) => (
            <Box
              key={item.instance}
              role="listitem"
              tabIndex={0}
              data-testid={`world-item-${item.instance.toUpperCase()}`}
              title={`Place ${item.name} (${item.instance}) in the world`}
              onClick={() => onPlace(item.instance)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onPlace(item.instance);
              }}
              sx={{
                width: TILE + 16, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 0.25, p: 0.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {item.visual === null
                ? <Box sx={{ width: TILE, height: TILE, bgcolor: 'action.hover', borderRadius: 0.5 }} />
                : <Thumbnail thumbnails={thumbnails} name={item.visual} size={TILE} />}
              <Typography variant="caption" noWrap sx={{ maxWidth: '100%', fontSize: 10 }} title={item.name}>
                {item.name}
              </Typography>
              <Typography variant="caption" noWrap color="text.secondary" sx={{ maxWidth: '100%', fontSize: 9 }}>
                {item.instance}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
      {shown.length > MAX_TILES && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 0.25 }}>
          {`${shown.length.toLocaleString()} items match — narrow the search to see the rest.`}
        </Typography>
      )}
    </Box>
  );
};

export default WorldItemCatalogue;
