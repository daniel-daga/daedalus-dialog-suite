import React, { useMemo, useState } from 'react';
import {
  Box, Button, Dialog, DialogContent, DialogTitle, IconButton, TextField, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {
  formatContainerContents, parseContainerContents, type ContainerEntry,
} from 'zen-world';
import type { AssetThumbnails } from '../../world/assetThumbnails';
import { Thumbnail } from './WorldAssetGrid';

// The chest-contents editor (level-editor.md §16.26 row 2) — Spacer.NET's
// "convenient editing of chests contents", and here by picture: an item is
// added from a grid of the loaded scripts' item instances drawn with the
// visual each declares, through the same thumbnail queue the Assets panel's
// grid uses. What leaves is the archive's own `contains` string, canonical
// (`containerContents.ts`), through the same `SetVobClassProp` every other
// class field takes.
//
// The item index rule is `oCItem.instance`'s (§7): with an index, an
// instance the scripts do not declare cannot be added — the picker offers
// the index and nothing else; with no index, "nothing is known", and a name
// is typed and shape-checked only.

const INSTANCE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ROW_THUMB = 32;

export interface ContainerContentsFieldProps {
  /** The archive string as the world holds it. */
  value: string;
  /** Every item instance the loaded scripts declare, uppercased; empty when
   *  no project is loaded. */
  itemInstances: ReadonlySet<string>;
  /** Uppercased instance → the visual its script declares, for the picture. */
  itemVisuals?: ReadonlyMap<string, string>;
  thumbnails?: AssetThumbnails | null;
  onCommit: (contents: string) => void;
}

const ContainerContentsField: React.FC<ContainerContentsFieldProps> = ({
  value, itemInstances, itemVisuals, thumbnails, onCommit,
}) => {
  const entries = useMemo(() => parseContainerContents(value), [value]);
  const [picking, setPicking] = useState(false);

  const commit = (next: readonly ContainerEntry[]) => onCommit(formatContainerContents(next));
  const visualOf = (instance: string) => itemVisuals?.get(instance.toUpperCase());

  // A string the grammar does not read — a hand-edited world can hold one —
  // is shown as it is and can be replaced by a picked list, never silently
  // rewritten.
  if (entries === null) {
    return (
      <Box>
        <Typography variant="caption" color="warning.main" data-testid="world-prop-contents-unreadable">
          {`Not a readable contents list: ${value}`}
        </Typography>
        <Button size="small" onClick={() => commit([])} data-testid="world-prop-contents-clear">Clear</Button>
      </Box>
    );
  }

  return (
    <Box data-testid="world-prop-contents">
      {entries.map((entry, index) => (
        <Box
          key={`${entry.instance}-${index}`}
          data-testid={`world-prop-contents-row-${entry.instance}`}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25 }}
        >
          {thumbnails && visualOf(entry.instance) !== undefined
            ? <Thumbnail thumbnails={thumbnails} name={visualOf(entry.instance)!} size={ROW_THUMB} />
            : <Box sx={{ width: ROW_THUMB, height: ROW_THUMB, flexShrink: 0 }} />}
          <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }} title={entry.instance}>
            {entry.instance}
          </Typography>
          <TextField
            key={`${entry.count}`}
            variant="standard"
            size="small"
            type="number"
            defaultValue={entry.count}
            inputProps={{
              min: 1, step: 1, 'data-testid': `world-prop-contents-count-${entry.instance}`,
              style: { width: 48, fontSize: 12, textAlign: 'right' },
            }}
            onBlur={(event) => {
              const count = Number(event.target.value);
              if (!Number.isInteger(count) || count < 1 || count === entry.count) return;
              commit(entries.map((other, at) => (at === index ? { ...other, count } : other)));
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
          />
          <IconButton
            size="small"
            aria-label={`Remove ${entry.instance}`}
            data-testid={`world-prop-contents-remove-${entry.instance}`}
            onClick={() => commit(entries.filter((_, at) => at !== index))}
            sx={{ p: 0.25 }}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
      ))}
      <Button size="small" onClick={() => setPicking(true)} data-testid="world-prop-contents-add">
        Add item…
      </Button>
      {picking && (
        <ItemPicker
          itemInstances={itemInstances}
          itemVisuals={itemVisuals}
          thumbnails={thumbnails}
          onPick={(instance) => {
            setPicking(false);
            const at = entries.findIndex((entry) => entry.instance.toUpperCase() === instance.toUpperCase());
            // Picking an item the chest already holds adds one to its count.
            commit(at === -1
              ? [...entries, { instance, count: 1 }]
              : entries.map((entry, index) => (index === at ? { ...entry, count: entry.count + 1 } : entry)));
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Box>
  );
};

const PICKER_THUMB = 64;

/** The item grid, or a typed name when nothing is known. */
const ItemPicker: React.FC<{
  itemInstances: ReadonlySet<string>;
  itemVisuals?: ReadonlyMap<string, string>;
  thumbnails?: AssetThumbnails | null;
  onPick: (instance: string) => void;
  onClose: () => void;
}> = ({ itemInstances, itemVisuals, thumbnails, onPick, onClose }) => {
  const [filter, setFilter] = useState('');
  const names = useMemo(() => [...itemInstances].sort(), [itemInstances]);
  const needle = filter.trim().toUpperCase();
  const shown = needle === '' ? names : names.filter((name) => name.includes(needle));

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth data-testid="world-prop-contents-picker">
      <DialogTitle sx={{ fontSize: 14, py: 1 }}>Add an item</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {itemInstances.size === 0
          ? (
            <TextField
              autoFocus
              size="small"
              variant="standard"
              placeholder="Item instance, e.g. ItMi_Gold"
              helperText="No script project is loaded, so the name is checked for shape only."
              inputProps={{ 'data-testid': 'world-prop-contents-typed' }}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const typed = filter.trim();
                if (INSTANCE.test(typed)) onPick(typed);
              }}
            />
          )
          : (
            <>
              <TextField
                autoFocus
                size="small"
                variant="standard"
                placeholder="Filter items"
                inputProps={{ 'data-testid': 'world-prop-contents-filter' }}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 420, overflowY: 'auto' }} role="list" aria-label="Items">
                {shown.slice(0, 400).map((name) => {
                  const visual = itemVisuals?.get(name);
                  return (
                    <Box
                      key={name}
                      role="listitem"
                      data-testid={`world-prop-contents-item-${name}`}
                      onClick={() => onPick(name)}
                      sx={{
                        width: PICKER_THUMB + 16, display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: 0.25, p: 0.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      {thumbnails && visual !== undefined
                        ? <Thumbnail thumbnails={thumbnails} name={visual} size={PICKER_THUMB} />
                        : <Box sx={{ width: PICKER_THUMB, height: PICKER_THUMB, bgcolor: 'action.hover', borderRadius: 0.5 }} />}
                      <Typography variant="caption" noWrap sx={{ maxWidth: '100%', fontSize: 10 }} title={name}>{name}</Typography>
                    </Box>
                  );
                })}
              </Box>
              {shown.length > 400 && (
                <Typography variant="caption" color="text.secondary">
                  {`${shown.length.toLocaleString()} items match — narrow the filter to see the rest.`}
                </Typography>
              )}
            </>
          )}
      </DialogContent>
    </Dialog>
  );
};

export default ContainerContentsField;
