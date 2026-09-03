import React, { memo, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Box, Typography } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';
import { FixedSizeGrid as Grid, type GridChildComponentProps, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { VfsEntry } from '../../../shared/worldTypes';
import { THUMBNAIL_SIZE } from '../../world/ThumbnailRenderer';
import type { AssetThumbnails, ThumbnailState } from '../../world/assetThumbnails';

// The Assets panel's tile view (level-editor.md §16.26 row 1) — Spacer's
// *VOB Bilder* and Spacer.NET's *preview models* as a grid over the same
// listing the list view shows. Virtualised like the list: a tile asks the
// queue for its picture when it mounts, so only what is on screen is drawn,
// and a directory of 300 files costs 300 draws only if all 300 are scrolled
// past.

export const TILE_WIDTH = THUMBNAIL_SIZE + 16;
export const TILE_HEIGHT = THUMBNAIL_SIZE + 36;

/** A tile's thumbnail state, subscribed to the queue so an arriving picture
 *  redraws only that tile. */
export function useThumbnail(thumbnails: AssetThumbnails, name: string): ThumbnailState | undefined {
  return useSyncExternalStore(
    (listener) => thumbnails.subscribe(listener),
    () => thumbnails.get(name),
  );
}

export const Thumbnail: React.FC<{ thumbnails: AssetThumbnails; name: string; size?: number }> = ({
  thumbnails, name, size = THUMBNAIL_SIZE,
}) => {
  const state = useThumbnail(thumbnails, name);
  useEffect(() => { thumbnails.request(name); }, [thumbnails, name]);

  const frame = {
    width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
    bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden',
  };
  if (state?.status === 'ready') {
    return (
      <Box sx={frame}>
        <img src={state.dataUrl} alt={name} width={size} height={size} style={{ display: 'block', imageRendering: 'auto' }} />
      </Box>
    );
  }
  if (state?.status === 'failed') {
    return (
      <Box sx={frame} data-testid="world-asset-thumb-failed" title="No thumbnail — the binding extracts nothing for this file">
        <BrokenImageOutlinedIcon sx={{ color: 'text.disabled' }} />
      </Box>
    );
  }
  return (
    <Box sx={frame} data-testid="world-asset-thumb-pending">
      <Typography variant="caption" color="text.disabled">{name.slice(name.lastIndexOf('.') + 1).toUpperCase()}</Typography>
    </Box>
  );
};

interface CellData {
  entries: VfsEntry[];
  columns: number;
  thumbnails: AssetThumbnails;
  onOpen: (entry: VfsEntry) => void;
}

const Cell = memo(({ columnIndex, rowIndex, style, data }: GridChildComponentProps<CellData>) => {
  const entry = data.entries[rowIndex * data.columns + columnIndex];
  if (entry === undefined) return null;
  return (
    <Box
      role="listitem"
      data-testid={`world-asset-tile-${entry.name}`}
      onClick={() => data.onOpen(entry)}
      style={style}
      sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, p: 1, cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {entry.type === 'directory'
        ? (
          <Box sx={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FolderIcon sx={{ color: 'text.secondary', fontSize: 48 }} />
          </Box>
        )
        : <Thumbnail thumbnails={data.thumbnails} name={entry.name} />}
      <Typography variant="caption" noWrap sx={{ maxWidth: '100%' }} title={entry.name}>{entry.name}</Typography>
    </Box>
  );
}, areEqual);
Cell.displayName = 'WorldAssetTile';

export interface WorldAssetGridProps {
  entries: VfsEntry[];
  thumbnails: AssetThumbnails;
  onOpen: (entry: VfsEntry) => void;
}

const WorldAssetGrid: React.FC<WorldAssetGridProps> = ({ entries, thumbnails, onOpen }) => (
  <AutoSizer>
    {({ height, width }) => {
      const columns = Math.max(1, Math.floor(width / TILE_WIDTH));
      return <SizedGrid height={height} width={width} columns={columns} entries={entries} thumbnails={thumbnails} onOpen={onOpen} />;
    }}
  </AutoSizer>
);

const SizedGrid: React.FC<WorldAssetGridProps & { height: number; width: number; columns: number }> = ({
  height, width, columns, entries, thumbnails, onOpen,
}) => {
  const itemData = useMemo<CellData>(() => ({ entries, columns, thumbnails, onOpen }), [entries, columns, thumbnails, onOpen]);
  return (
    <Grid
      height={height}
      width={width}
      columnCount={columns}
      columnWidth={Math.floor(width / columns)}
      rowCount={Math.ceil(entries.length / columns)}
      rowHeight={TILE_HEIGHT}
      itemData={itemData}
      overscanRowCount={2}
    >
      {Cell}
    </Grid>
  );
};

export default WorldAssetGrid;
