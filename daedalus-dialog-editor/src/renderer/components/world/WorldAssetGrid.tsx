import React, { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Box, IconButton, Menu, MenuItem, TextField, Typography } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { FixedSizeGrid as Grid, type GridChildComponentProps, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { VfsEntry } from '../../../shared/worldTypes';
import { THUMBNAIL_SIZE } from '../../world/ThumbnailRenderer';
import type { LiveTilePreview } from '../../world/LiveTilePreview';
import { thumbnailKindOf, type AssetThumbnails, type ThumbnailState } from '../../world/assetThumbnails';

// The Assets panel's tile view (level-editor.md §16.26 row 1) — Spacer's
// *VOB Bilder* and Spacer.NET's *preview models* as a grid over the same
// listing the list view shows. Virtualised like the list: a tile asks the
// queue for its picture when it mounts, so only what is on screen is drawn,
// and a directory of 300 files costs 300 draws only if all 300 are scrolled
// past. The same tile serves the favorites and category views ("Wanted on
// top"), which is where its star and its file-into menu come from.

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

/** The one live render the tiles share, or null where there is none — a
 *  surface with no world open, and every suite that does not stub it. A
 *  context rather than a prop because the tile is four components down and
 *  three of them have no other reason to know about it. */
export const LiveTileContext = React.createContext<LiveTilePreview | null>(null);

/** How far the pointer travels before a press counts as a turn and not as a
 *  click — the tile is 96 px, so this is small. */
const DRAG_SLOP = 4;

export const Thumbnail: React.FC<{ thumbnails: AssetThumbnails; name: string; size?: number }> = ({
  thumbnails, name, size = THUMBNAIL_SIZE,
}) => {
  const state = useThumbnail(thumbnails, name);
  useEffect(() => { thumbnails.request(name); }, [thumbnails, name]);

  // The still is a frame of a scene, so the tile under the pointer runs the
  // scene instead (level-editor.md §16.26 row 1). A texture has no geometry
  // to turn and stays the flat image it correctly is.
  const live = React.useContext(LiveTileContext);
  const turnable = live !== null && thumbnailKindOf(name) === 'mesh';
  const frameRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; turned: boolean } | null>(null);
  useEffect(() => {
    const host = frameRef.current;
    // Unmounting under the pointer — a scroll in a virtualised grid does it
    // every row — leaves no pointerleave behind it.
    return () => { if (host !== null) live?.hide(host); };
  }, [live, name]);

  const turn = !turnable ? {} : {
    onPointerEnter: () => { void live.show(name, frameRef.current!, size); },
    onPointerLeave: () => { live.hide(frameRef.current!); },
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // Optional, as in `PanelSplitter`: the capture keeps the turn going
      // when the pointer leaves the 96 px tile, and jsdom implements
      // neither call.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, turned: false };
      live.beginDrag();
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      const from = drag.current;
      if (from === null) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) from.turned = true;
      drag.current = { x: event.clientX, y: event.clientY, turned: from.turned };
      live.drag(dx, dy);
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      if (drag.current === null) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      live.endDrag();
      // The capture kept every move on this tile, so a release outside it is
      // a pointer that has already left.
      const box = event.currentTarget.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) live.hide(event.currentTarget);
    },
    onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
      const turned = drag.current?.turned ?? false;
      drag.current = null;
      // A turn ends in a click the tile must not read as "open me".
      if (turned) event.stopPropagation();
    },
  };

  const frame = {
    width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
    bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden',
    position: 'relative', ...(turnable ? { cursor: 'grab' } : {}),
  };
  const shared = {
    ref: frameRef, sx: frame, ...turn,
    ...(turnable ? { title: 'Drag to turn' } : {}),
  };
  if (state?.status === 'ready') {
    return (
      <Box {...shared}>
        <img src={state.dataUrl} alt={name} width={size} height={size} style={{ display: 'block', imageRendering: 'auto' }} />
      </Box>
    );
  }
  if (state?.status === 'failed') {
    return (
      <Box
        {...shared}
        data-testid="world-asset-thumb-failed"
        title="No thumbnail — the binding extracts nothing for this file"
      >
        <BrokenImageOutlinedIcon sx={{ color: 'text.disabled' }} />
      </Box>
    );
  }
  return (
    <Box {...shared} data-testid="world-asset-thumb-pending">
      <Typography variant="caption" color="text.disabled">{name.slice(name.lastIndexOf('.') + 1).toUpperCase()}</Typography>
    </Box>
  );
};

/** What a tile can do to the catalogue — undefined when no project sidecar
 *  is loaded, in which case tiles carry no star and no menu. */
export interface TileCatalogActions {
  isFavorite: (name: string) => boolean;
  onToggleFavorite: (name: string) => void;
  /** Every category path the merged catalogue has, for the file-into menu. */
  categoryPaths: readonly string[];
  onAddToCategory: (path: string, name: string) => void;
  /** Present only in a category view — a visual the project filed itself
   *  can be dropped from it; a seed entry is not the project's to drop, and
   *  `removable` says which is which. */
  onUnfile?: (name: string) => void;
  removable?: (name: string) => boolean;
}

/** The file-into menu: every known category, plus a field for a new one. */
const FileIntoMenu: React.FC<{
  anchor: HTMLElement | null; name: string; actions: TileCatalogActions; onClose: () => void;
}> = ({ anchor, name, actions, onClose }) => {
  const [fresh, setFresh] = useState('');
  return (
    <Menu open={anchor !== null} anchorEl={anchor} onClose={onClose}>
      {actions.categoryPaths.map((path) => (
        <MenuItem
          key={path}
          dense
          data-testid={`world-asset-file-into-${path}`}
          onClick={() => { actions.onAddToCategory(path, name); onClose(); }}
        >
          {path}
        </MenuItem>
      ))}
      <Box sx={{ px: 1.5, py: 0.5 }} onKeyDown={(event) => event.stopPropagation()}>
        <TextField
          size="small"
          variant="standard"
          placeholder="New category…"
          value={fresh}
          onChange={(event) => setFresh(event.target.value)}
          inputProps={{ 'data-testid': 'world-asset-file-new' }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || fresh.trim() === '') return;
            actions.onAddToCategory(fresh.trim(), name);
            onClose();
          }}
        />
      </Box>
    </Menu>
  );
};

export const AssetTile: React.FC<{
  entry: VfsEntry;
  thumbnails: AssetThumbnails;
  onOpen: (entry: VfsEntry) => void;
  actions?: TileCatalogActions;
  style?: React.CSSProperties;
}> = ({ entry, thumbnails, onOpen, actions, style }) => {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const isFile = entry.type === 'file';
  const favorite = isFile && actions !== undefined && actions.isFavorite(entry.name);

  return (
    <Box
      role="listitem"
      data-testid={`world-asset-tile-${entry.name}`}
      onClick={() => onOpen(entry)}
      style={style}
      sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, p: 1, cursor: 'pointer',
        position: 'relative', '&:hover': { bgcolor: 'action.hover' },
        '&:hover .tile-actions, & .tile-actions.on': { opacity: 1 },
      }}
    >
      {isFile
        ? <Thumbnail thumbnails={thumbnails} name={entry.name} />
        : (
          <Box sx={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FolderIcon sx={{ color: 'text.secondary', fontSize: 48 }} />
          </Box>
        )}
      <Typography variant="caption" noWrap sx={{ maxWidth: '100%' }} title={entry.name}>{entry.name}</Typography>
      {isFile && actions !== undefined && (
        <Box
          className={`tile-actions${favorite ? ' on' : ''}`}
          sx={{ position: 'absolute', top: 4, left: 4, right: 4, display: 'flex', justifyContent: 'space-between', opacity: 0 }}
          onClick={(event) => event.stopPropagation()}
        >
          <IconButton
            size="small"
            aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={favorite}
            data-testid="world-asset-star"
            onClick={() => actions.onToggleFavorite(entry.name)}
            sx={{ p: 0.25 }}
          >
            {favorite
              ? <StarIcon sx={{ fontSize: 16, color: 'warning.main' }} />
              : <StarBorderIcon sx={{ fontSize: 16 }} />}
          </IconButton>
          <Box>
            {actions.onUnfile !== undefined && (actions.removable?.(entry.name) ?? true) && (
              <IconButton
                size="small"
                aria-label="Remove from this category"
                data-testid="world-asset-unfile"
                onClick={() => actions.onUnfile!(entry.name)}
                sx={{ p: 0.25 }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
            <IconButton
              size="small"
              aria-label="File into a category"
              data-testid="world-asset-file"
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              sx={{ p: 0.25 }}
            >
              <LabelOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
          {menuAnchor !== null && (
            <FileIntoMenu anchor={menuAnchor} name={entry.name} actions={actions} onClose={() => setMenuAnchor(null)} />
          )}
        </Box>
      )}
    </Box>
  );
};

interface CellData {
  entries: VfsEntry[];
  columns: number;
  thumbnails: AssetThumbnails;
  onOpen: (entry: VfsEntry) => void;
  actions?: TileCatalogActions;
}

const Cell = memo(({ columnIndex, rowIndex, style, data }: GridChildComponentProps<CellData>) => {
  const entry = data.entries[rowIndex * data.columns + columnIndex];
  if (entry === undefined) return null;
  return <AssetTile entry={entry} thumbnails={data.thumbnails} onOpen={data.onOpen} actions={data.actions} style={style} />;
}, areEqual);
Cell.displayName = 'WorldAssetTile';

export interface WorldAssetGridProps {
  entries: VfsEntry[];
  thumbnails: AssetThumbnails;
  onOpen: (entry: VfsEntry) => void;
  actions?: TileCatalogActions;
}

const WorldAssetGrid: React.FC<WorldAssetGridProps> = ({ entries, thumbnails, onOpen, actions }) => (
  <AutoSizer>
    {({ height, width }) => {
      const columns = Math.max(1, Math.floor(width / TILE_WIDTH));
      return (
        <SizedGrid
          height={height} width={width} columns={columns}
          entries={entries} thumbnails={thumbnails} onOpen={onOpen} actions={actions}
        />
      );
    }}
  </AutoSizer>
);

const SizedGrid: React.FC<WorldAssetGridProps & { height: number; width: number; columns: number }> = ({
  height, width, columns, entries, thumbnails, onOpen, actions,
}) => {
  const itemData = useMemo<CellData>(
    () => ({ entries, columns, thumbnails, onOpen, actions }),
    [entries, columns, thumbnails, onOpen, actions],
  );
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
