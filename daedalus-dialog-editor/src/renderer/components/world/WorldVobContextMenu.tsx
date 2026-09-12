import React, { useEffect, useState } from 'react';
import {
  Divider, ListItemIcon, ListItemText, Menu, MenuItem, TextField, Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import DeleteIcon from '@mui/icons-material/Delete';
import ExploreIcon from '@mui/icons-material/Explore';
import FolderIcon from '@mui/icons-material/Folder';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

/**
 * The right-click menu over a VOB — the app's **first** context menu
 * (level-editor.md §17, production-readiness F10). It
 * becomes the pattern the rest of the app follows; nothing here is
 * abstracted ahead of a second consumer.
 *
 * Every item only calls a handler `WorldSurface` already has — this
 * component adds no new edit logic of its own, only the menu around
 * existing ones. Enablement mirrors the toolbar's own rules (Delete: any
 * non-empty selection, since #253).
 */
export interface WorldVobContextMenuProps {
  open: boolean;
  /** Anchor position in viewport coordinates — null while closed, so the
   *  `Menu` never has to anchor to a stale point. */
  position: { left: number; top: number } | null;
  onClose: () => void;
  selectionCount: number;
  /** Whether the clipboard has anything a paste would place. */
  canPaste: boolean;
  onFrame: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDeleteRequest: () => void;
  onDropToGround: () => void;
  onAlignToNormal: () => void;
  onHideClass: () => void;
  /** Existing folders (VOB folders slice) — just enough to list them, not the
   *  member paths, which this menu never reads. */
  folders: readonly { id: string; name: string }[];
  onAddSelectionToFolder: (id: string) => void;
  /** Create a folder and add the current selection to it in one step —
   *  "New folder…" inside the submenu, rather than a second round trip. */
  onCreateFolderWithSelection: (name: string) => void;
}

/** The key a menu item names, set to the right of its label. Every item that
 *  has one shows it — Duplicate was the exception until it got Ctrl+D (#253),
 *  because a hint invented for an unbound command is a shortcut that does not
 *  work. */
const Shortcut: React.FC<{ keys: string }> = ({ keys }) => (
  <Typography variant="caption" color="text.secondary" sx={{ ml: 3 }}>{keys}</Typography>
);

const WorldVobContextMenu: React.FC<WorldVobContextMenuProps> = ({
  open, position, onClose, selectionCount, canPaste,
  onFrame, onDuplicate, onCopy, onPaste, onDeleteRequest, onDropToGround, onAlignToNormal, onHideClass,
  folders, onAddSelectionToFolder, onCreateFolderWithSelection,
}) => {
  /** Every item takes its action and closes the menu — nothing here stays
   *  open after a click, including Delete, which only opens the existing
   *  confirm dialog. */
  const run = (action: () => void) => () => { onClose(); action(); };

  // "Add to Folder ▸" — MUI has no built-in nested menu, so this is a second
  // `Menu` anchored to the item's own element rather than a `Menu`-in-
  // `MenuItem`: fewer moving parts, and it is easy to test through the same
  // `data-testid` pattern every other item already uses.
  const [folderMenuAnchor, setFolderMenuAnchor] = useState<HTMLElement | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const closeFolderMenu = () => {
    setFolderMenuAnchor(null);
    setCreatingFolder(false);
    setNewFolderName('');
  };
  const closeAll = () => { closeFolderMenu(); onClose(); };
  // The parent closes the outer menu directly too (a new right-click, e.g.),
  // which never runs `closeAll` — this is what stops a stale submenu from
  // reopening under the next right-click.
  useEffect(() => { if (!open) closeFolderMenu(); }, [open]);
  const submitNewFolder = () => {
    const name = newFolderName.trim();
    if (name === '') return;
    onCreateFolderWithSelection(name);
    closeAll();
  };

  return (
    <Menu
      open={open}
      onClose={closeAll}
      anchorReference="anchorPosition"
      anchorPosition={position ?? undefined}
      data-testid="world-context-menu"
      MenuListProps={{ dense: true }}
    >
      {/* One verb for one command, and the key that does it. The tree's
          locator used to say "Jump the camera to this VOB" and only the
          property grid's copy named the key (§5.4 item 19 of the 2026-09-04
          review); all three now say Frame, and say ".". */}
      <MenuItem onClick={run(onFrame)} data-testid="world-context-frame">
        <ListItemIcon><MyLocationIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Frame</ListItemText>
        <Shortcut keys="." />
      </MenuItem>
      <Divider />
      <MenuItem onClick={run(onDuplicate)} disabled={selectionCount === 0} data-testid="world-context-duplicate">
        <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{selectionCount > 1 ? `Duplicate ${selectionCount} VOBs` : 'Duplicate VOB'}</ListItemText>
        <Shortcut keys="Ctrl+D" />
      </MenuItem>
      <MenuItem onClick={run(onCopy)} disabled={selectionCount === 0} data-testid="world-context-copy">
        <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Copy</ListItemText>
        <Shortcut keys="Ctrl+C" />
      </MenuItem>
      <MenuItem onClick={run(onPaste)} disabled={!canPaste} data-testid="world-context-paste">
        <ListItemIcon><ContentPasteIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Paste</ListItemText>
        <Shortcut keys="Ctrl+V" />
      </MenuItem>
      <Divider />
      <MenuItem
        onClick={(event) => setFolderMenuAnchor(event.currentTarget)}
        disabled={selectionCount === 0}
        data-testid="world-context-add-to-folder"
      >
        <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Add to Folder</ListItemText>
        <ChevronRightIcon fontSize="small" sx={{ ml: 1, color: 'text.secondary' }} />
      </MenuItem>
      <Menu
        open={folderMenuAnchor !== null}
        anchorEl={folderMenuAnchor}
        onClose={closeFolderMenu}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        data-testid="world-context-folder-submenu"
        MenuListProps={{ dense: true }}
      >
        {folders.length === 0 && !creatingFolder && (
          <MenuItem disabled data-testid="world-context-folder-none">
            No folders yet
          </MenuItem>
        )}
        {folders.map((folder) => (
          <MenuItem
            key={folder.id}
            onClick={() => { onAddSelectionToFolder(folder.id); closeAll(); }}
            data-testid={`world-context-folder-${folder.id}`}
          >
            <ListItemText>{folder.name}</ListItemText>
          </MenuItem>
        ))}
        <Divider />
        {creatingFolder ? (
          <MenuItem disableRipple sx={{ '&:hover': { bgcolor: 'transparent' } }}>
            <TextField
              size="small"
              variant="standard"
              autoFocus
              placeholder="Folder name"
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitNewFolder();
                if (event.key === 'Escape') setCreatingFolder(false);
              }}
              inputProps={{ 'data-testid': 'world-context-folder-new-name' }}
            />
          </MenuItem>
        ) : (
          <MenuItem onClick={() => setCreatingFolder(true)} data-testid="world-context-folder-new">
            <ListItemIcon><CreateNewFolderIcon fontSize="small" /></ListItemIcon>
            <ListItemText>New folder…</ListItemText>
          </MenuItem>
        )}
      </Menu>
      <Divider />
      <MenuItem onClick={run(onDropToGround)} disabled={selectionCount === 0} data-testid="world-context-drop">
        <ListItemIcon><VerticalAlignBottomIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Drop to ground</ListItemText>
      </MenuItem>
      <MenuItem onClick={run(onAlignToNormal)} disabled={selectionCount === 0} data-testid="world-context-align">
        <ListItemIcon><ExploreIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Align to normal</ListItemText>
      </MenuItem>
      <Divider />
      <MenuItem onClick={run(onHideClass)} data-testid="world-context-hide-class">
        <ListItemIcon><VisibilityOffIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Hide this class</ListItemText>
      </MenuItem>
      <Divider />
      <MenuItem
        onClick={run(onDeleteRequest)}
        disabled={selectionCount === 0}
        data-testid="world-context-delete"
        sx={{ color: 'error.main' }}
      >
        <ListItemIcon sx={{ color: 'error.main' }}><DeleteIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{selectionCount > 1 ? `Delete ${selectionCount} VOBs…` : 'Delete VOB…'}</ListItemText>
        <Shortcut keys="Del" />
      </MenuItem>
    </Menu>
  );
};

export default WorldVobContextMenu;
