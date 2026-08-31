import React from 'react';
import { Divider, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import DeleteIcon from '@mui/icons-material/Delete';
import ExploreIcon from '@mui/icons-material/Explore';
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
 * existing ones. Enablement mirrors the toolbar's own rules (Delete:
 * exactly one VOB selected).
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
}

const WorldVobContextMenu: React.FC<WorldVobContextMenuProps> = ({
  open, position, onClose, selectionCount, canPaste,
  onFrame, onDuplicate, onCopy, onPaste, onDeleteRequest, onDropToGround, onAlignToNormal, onHideClass,
}) => {
  /** Every item takes its action and closes the menu — nothing here stays
   *  open after a click, including Delete, which only opens the existing
   *  confirm dialog. */
  const run = (action: () => void) => () => { onClose(); action(); };

  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={position ?? undefined}
      data-testid="world-context-menu"
      MenuListProps={{ dense: true }}
    >
      <MenuItem onClick={run(onFrame)} data-testid="world-context-frame">
        <ListItemIcon><MyLocationIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Frame</ListItemText>
      </MenuItem>
      <Divider />
      <MenuItem onClick={run(onDuplicate)} disabled={selectionCount === 0} data-testid="world-context-duplicate">
        <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{selectionCount > 1 ? `Duplicate ${selectionCount} VOBs` : 'Duplicate VOB'}</ListItemText>
      </MenuItem>
      <MenuItem onClick={run(onCopy)} disabled={selectionCount === 0} data-testid="world-context-copy">
        <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Copy</ListItemText>
      </MenuItem>
      <MenuItem onClick={run(onPaste)} disabled={!canPaste} data-testid="world-context-paste">
        <ListItemIcon><ContentPasteIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Paste</ListItemText>
      </MenuItem>
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
        disabled={selectionCount !== 1}
        data-testid="world-context-delete"
        sx={{ color: 'error.main' }}
      >
        <ListItemIcon sx={{ color: 'error.main' }}><DeleteIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Delete VOB…</ListItemText>
      </MenuItem>
    </Menu>
  );
};

export default WorldVobContextMenu;
