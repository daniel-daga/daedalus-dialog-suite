import React, { useMemo, useState } from 'react';
import { Box, Button, IconButton, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { ContainerEntry } from 'zen-world';
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
//
// **"Add to container" is the same list with the other verb** (#418): a mode
// rather than a second gesture on the same tile, because a click already places
// an item and a click that sometimes did the other thing would be a coin toss.
// In it, a click stages an item, each staged row takes a count, and one
// confirm writes all of them into the selected `oCMobContainer` through the
// same `SetVobClassProp` its contents field takes — one op, therefore one undo.

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
  /** The container the add mode writes into: the selected `oCMobContainer`, by
   *  the name the property grid shows. Null when the selection is not one. */
  container: string | null;
  /** Write these entries into that container in one op. Absent until the
   *  container's fields have been read — they are the op's `from` side. */
  onAddToContainer?: (entries: readonly ContainerEntry[]) => void;
}

const WorldItemCatalogue: React.FC<WorldItemCatalogueProps> = ({
  items, thumbnails, onPlace, container, onAddToContainer,
}) => {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => searchItemCatalogue(items, filter), [items, filter]);
  /** What the add mode has picked, in the order it was picked, with the count
   *  each row was given. */
  const [staged, setStaged] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [adding, setAdding] = useState(false);

  const toggle = (instance: string) => setStaged((current) => {
    const next = new Map(current);
    if (next.delete(instance)) return next;
    next.set(instance, 1);
    return next;
  });
  const setCount = (instance: string, count: number) => setStaged((current) => (
    new Map(current).set(instance, count)
  ));

  const act = (instance: string) => (adding ? toggle(instance) : onPlace(instance));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ px: 0.5, py: 0.25, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 0.5 }}>
        <TextField
          size="small"
          variant="outlined"
          placeholder="Search items"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          inputProps={{ 'data-testid': 'world-item-filter', 'aria-label': 'Search items' }}
          sx={{ flex: 1, minWidth: 0, '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
        />
        <Button
          size="small"
          variant={adding ? 'contained' : 'outlined'}
          onClick={() => setAdding(!adding)}
          data-testid="world-items-add-mode"
          aria-pressed={adding}
          sx={{ fontSize: 10, py: 0, px: 0.75, whiteSpace: 'nowrap' }}
        >
          Add to container
        </Button>
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
              title={adding
                ? `Add ${item.name} (${item.instance}) to the container`
                : `Place ${item.name} (${item.instance}) in the world`}
              onClick={() => act(item.instance)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                act(item.instance);
              }}
              sx={{
                width: TILE + 16, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 0.25, p: 0.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
                // The staged tile is the whole "this is going in" indicator: it
                // costs a border rather than a checkbox on every one of 400.
                border: 1, borderRadius: 0.5,
                borderColor: adding && staged.has(item.instance) ? 'primary.main' : 'transparent',
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
      {adding && (
        <Box
          data-testid="world-items-container-add"
          sx={{ borderTop: 1, borderColor: 'divider', px: 0.75, py: 0.5, maxHeight: '40%', overflowY: 'auto' }}
        >
          <Typography
            variant="caption"
            color={container === null ? 'warning.main' : 'text.secondary'}
            data-testid="world-items-container-target"
            sx={{ display: 'block' }}
          >
            {container === null
              ? 'Select a chest (oCMobContainer) to add these to.'
              : `Adding to ${container}`}
          </Typography>
          {[...staged].map(([instance, count]) => (
            <Box
              key={instance}
              data-testid={`world-items-staged-${instance.toUpperCase()}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25 }}
            >
              <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }} title={instance}>
                {instance}
              </Typography>
              {/* Uncontrolled with the count in its key, exactly as the
                  contents field's row does: a typed number is committed on
                  blur, and a refused one remounts showing the world's. */}
              <TextField
                key={count}
                variant="standard"
                size="small"
                type="number"
                defaultValue={count}
                inputProps={{
                  min: 1, step: 1, 'data-testid': `world-items-count-${instance.toUpperCase()}`,
                  style: { width: 48, fontSize: 12, textAlign: 'right' },
                }}
                onBlur={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isInteger(next) || next < 1 || next === count) return;
                  setCount(instance, next);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                }}
              />
              <IconButton
                size="small"
                aria-label={`Remove ${instance}`}
                data-testid={`world-items-unstage-${instance.toUpperCase()}`}
                onClick={() => toggle(instance)}
                sx={{ p: 0.25 }}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
          <Button
            size="small"
            variant="contained"
            data-testid="world-items-container-confirm"
            disabled={container === null || onAddToContainer === undefined || staged.size === 0}
            onClick={() => {
              if (onAddToContainer === undefined) return;
              onAddToContainer([...staged].map(([instance, count]) => ({ instance, count })));
              setStaged(new Map());
            }}
            sx={{ fontSize: 11 }}
          >
            {`Add ${staged.size} item${staged.size === 1 ? '' : 's'}`}
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default WorldItemCatalogue;
