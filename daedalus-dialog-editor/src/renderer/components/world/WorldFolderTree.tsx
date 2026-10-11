import React, { useMemo, useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { vobAtIndexPath, type VobFolder, type VobFolders, type VobReader } from 'zen-world';
import type { WorldSummary } from '../../../shared/worldTypes';
import { vobModelOf } from '../../world/vobModel';

// User-created VOB folders (VOB folders slice) — a grouping additional to the
// real scene tree in `WorldSceneTree.tsx`, never a replacement for it. A
// folder is never a VOB and holds no position of its own; it is a named list
// of `vobIndexPath` addresses, resolved against `reader` on every render.
//
// Not virtualized, unlike the scene tree: a user files VOBs into folders by
// hand, so folder counts and their member lists are nowhere near the 23,288
// rows the real tree has to survive.

const INDENT = 14;

/** A path whose VOB no longer exists is dropped from the row list, the same
 *  "dropped rather than remapped" rule `zen-world`'s `resolveFolderMembers`
 *  applies — but paired with the path itself, which removal needs and
 *  `resolveFolderMembers`'s plain `number[]` does not carry. */
function resolveMembers(reader: VobReader, folder: VobFolder): Array<{ path: string; vob: number }> {
  const members: Array<{ path: string; vob: number }> = [];
  for (const path of folder.vobPaths) {
    const vob = vobAtIndexPath(reader, path);
    if (vob !== null) members.push({ path, vob });
  }
  return members;
}

export interface WorldFolderTreeProps {
  folders: VobFolders;
  summary: WorldSummary;
  selection: readonly number[];
  onSelect: (vob: number, additive: boolean) => void;
  /** Absent when there is no viewport beside the tree, matching
   *  `WorldSceneTree`'s own `onFocus`. */
  onFocus?: (vob: number) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onRemoveFromFolder: (id: string, vobPath: string) => void;
}

const WorldFolderTree: React.FC<WorldFolderTreeProps> = ({
  folders, summary, selection, onSelect, onFocus,
  onCreateFolder, onRenameFolder, onDeleteFolder, onRemoveFromFolder,
}) => {
  const { reader } = useMemo(() => vobModelOf(summary), [summary]);
  const selected = new Set(selection);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [newFolderName, setNewFolderName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  /** The folder a delete is being confirmed for, or null. A folder is grouping
   *  somebody filed by hand and there is no undo for it by design
   *  (`docs/plans/vob-folders.md`), so the one click it used to take was the
   *  whole of what stood between that work and nothing (§5.4 item 18). */
  const [deleting, setDeleting] = useState<VobFolder | null>(null);

  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const createFolder = () => {
    const name = newFolderName.trim();
    if (name === '') return;
    onCreateFolder(name);
    setNewFolderName('');
  };

  const commitRename = () => {
    if (renaming === null) return;
    const name = renaming.name.trim();
    if (name !== '') onRenameFolder(renaming.id, name);
    setRenaming(null);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 0.5 }}>
        <TextField
          size="small"
          variant="outlined"
          placeholder="New folder"
          value={newFolderName}
          onChange={(event) => setNewFolderName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') createFolder(); }}
          inputProps={{ 'data-testid': 'world-folder-new-name', 'aria-label': 'New folder name' }}
          sx={{ flex: 1, minWidth: 0, '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
        />
        <Tooltip title="Create folder">
          <span>
            <IconButton
              size="small"
              onClick={createFolder}
              disabled={newFolderName.trim() === ''}
              data-testid="world-folder-create"
              aria-label="Create folder"
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }} role="tree" aria-label="VOB folders">
        {folders.folders.length === 0 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="world-folder-empty"
            sx={{ display: 'block', p: 1 }}
          >
            No folders yet.
          </Typography>
        ) : folders.folders.map((folder) => {
          const members = resolveMembers(reader, folder);
          const isOpen = expanded.has(folder.id);
          const isRenaming = renaming?.id === folder.id;

          return (
            <Box key={folder.id} data-testid={`world-folder-${folder.id}`}>
              <Box
                role="treeitem"
                aria-level={1}
                aria-expanded={isOpen}
                data-testid={`world-folder-row-${folder.id}`}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.5, pl: 0.5, pr: 1, minHeight: 28,
                  cursor: 'pointer',
                  // `:focus-within` as well, or a row's own verbs vanish the
                  // moment a keyboard reaches them (§5.4 item 18).
                  '&:hover .world-folder-verb, &:focus-within .world-folder-verb': { visibility: 'visible' },
                }}
              >
                <Box
                  component="span"
                  data-testid={`world-folder-toggle-${folder.id}`}
                  onClick={() => toggle(folder.id)}
                  sx={{ display: 'flex', width: 18, flexShrink: 0, color: 'text.secondary' }}
                >
                  {isOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                </Box>
                {isRenaming ? (
                  <TextField
                    size="small"
                    variant="standard"
                    autoFocus
                    value={renaming.name}
                    onChange={(event) => setRenaming({ id: folder.id, name: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename();
                      if (event.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={commitRename}
                    inputProps={{ 'data-testid': `world-folder-rename-${folder.id}`, style: { fontSize: 12 } }}
                    sx={{ flex: 1, minWidth: 0 }}
                  />
                ) : (
                  <Typography
                    variant="caption"
                    noWrap
                    onDoubleClick={() => setRenaming({ id: folder.id, name: folder.name })}
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    {folder.name}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary" noWrap sx={{ opacity: 0.75 }}>
                  {members.length}
                </Typography>
                {/* Buttons, not spans: the rename was a double-click on the
                    label and nothing on screen said so, and neither verb could
                    be reached without a pointer (§5.4 item 18 of the
                    2026-09-04 review). The double-click stays — it is what a
                    file manager does — but it is no longer the only way in. */}
                <Tooltip title="Rename folder">
                  <IconButton
                    size="small"
                    className="world-folder-verb"
                    data-testid={`world-folder-rename-open-${folder.id}`}
                    aria-label={`Rename ${folder.name}`}
                    onClick={() => setRenaming({ id: folder.id, name: folder.name })}
                    sx={{ p: 0.25, flexShrink: 0, visibility: 'hidden', color: 'text.secondary' }}
                  >
                    <EditIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete folder">
                  <IconButton
                    size="small"
                    className="world-folder-verb"
                    data-testid={`world-folder-delete-${folder.id}`}
                    aria-label={`Delete ${folder.name}`}
                    onClick={() => setDeleting(folder)}
                    sx={{ p: 0.25, flexShrink: 0, visibility: 'hidden', color: 'text.secondary' }}
                  >
                    <DeleteIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>
              {isOpen && members.map(({ path, vob }) => {
                const label = reader.name(vob) || reader.visual(vob);
                const isSelected = selected.has(vob);
                return (
                  <Box
                    key={path}
                    role="treeitem"
                    aria-level={2}
                    aria-selected={isSelected}
                    data-testid={`world-folder-member-${folder.id}-${vob}`}
                    onClick={(event) => onSelect(vob, event.shiftKey || event.ctrlKey || event.metaKey)}
                    onDoubleClick={onFocus === undefined ? undefined : () => onFocus(vob)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
                      pl: `${4 + INDENT}px`, pr: 1, minHeight: 26, whiteSpace: 'nowrap',
                      bgcolor: isSelected ? 'action.selected' : undefined,
                      '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
                      '&:hover .world-folder-member-locate, &:hover .world-folder-member-remove': { visibility: 'visible' },
                    }}
                  >
                    {label
                      ? <Typography variant="caption" noWrap>{label}</Typography>
                      : null}
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ opacity: 0.75 }}>
                      {reader.className(vob)}
                    </Typography>
                    {onFocus !== undefined && (
                      <Box
                        component="span"
                        className="world-folder-member-locate"
                        title="Frame this VOB (.)"
                        data-testid={`world-folder-member-locate-${folder.id}-${vob}`}
                        onClick={(event) => { event.stopPropagation(); onFocus(vob); }}
                        sx={{ display: 'flex', ml: 'auto', flexShrink: 0, pl: 0.5, visibility: 'hidden', color: 'text.secondary' }}
                      >
                        <MyLocationIcon sx={{ fontSize: 14 }} />
                      </Box>
                    )}
                    <Box
                      component="span"
                      className="world-folder-member-remove"
                      title="Remove from folder"
                      data-testid={`world-folder-member-remove-${folder.id}-${vob}`}
                      onClick={(event) => { event.stopPropagation(); onRemoveFromFolder(folder.id, path); }}
                      sx={{ display: 'flex', flexShrink: 0, pl: 0.5, visibility: 'hidden', color: 'text.secondary' }}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </Box>
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete this folder?</DialogTitle>
        <DialogContent>
          <DialogContentText data-testid="world-folder-delete-warning">
            {deleting === null ? '' : `"${deleting.name}" and its grouping go, and there is no undo for it. The ${resolveMembers(reader, deleting).length} VOBs in it stay in the world.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)} data-testid="world-folder-delete-cancel">
            Keep it
          </Button>
          <Button
            color="error"
            data-testid="world-folder-delete-confirm"
            onClick={() => {
              if (deleting !== null) onDeleteFolder(deleting.id);
              setDeleting(null);
            }}
          >
            Delete folder
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorldFolderTree;
