import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { FixedSizeList as List, type ListChildComponentProps, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { VfsEntry } from '../../../shared/worldTypes';

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
}

const WorldAssetBrowser: React.FC<WorldAssetBrowserProps> = ({ listAssets, onPreview }) => {
  const [path, setPath] = useState('/');
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

  const itemData = useMemo<RowData>(() => ({ entries: sorted, onOpen }), [sorted, onOpen]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, py: 0.25,
        borderBottom: 1, borderColor: 'divider',
      }}>
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
        <Typography variant="caption" color="text.secondary" noWrap data-testid="world-asset-path">
          {path}
        </Typography>
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

      {state.status === 'ready' && sorted.length > 0 && (
        <Box sx={{ flex: 1, minHeight: 0 }} role="list" aria-label="Mounted assets">
          <AutoSizer>
            {({ height, width }) => (
              <List
                height={height}
                width={width}
                itemCount={sorted.length}
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
    </Box>
  );
};

export default WorldAssetBrowser;
