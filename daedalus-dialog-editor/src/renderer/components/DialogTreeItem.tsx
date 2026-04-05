import React, { memo, CSSProperties, useState, useRef, useCallback, useEffect } from 'react';
import {
  Box,
  ListItemButton,
  ListItemText,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  TextField,
  Divider,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import type { SemanticModel } from '../types/global';
import { searchablePaneRowButtonSx } from './common/searchablePaneStyles';

void React;

interface DialogTreeItemProps {
  dialogName: string;
  semanticModel: SemanticModel;
  isSelected: boolean;
  isExpanded: boolean;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleDialogExpand: (dialogName: string) => void;
  hasChildren: boolean;
  style: CSSProperties;
  onDeleteDialog?: (dialogName: string) => void;
  onRenameDialog?: (dialogName: string) => void;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DialogTreeItem = memo(({
  dialogName,
  semanticModel,
  isSelected,
  isExpanded,
  onSelectDialog,
  onToggleDialogExpand,
  hasChildren,
  style,
  onDeleteDialog,
  onRenameDialog,
}: DialogTreeItemProps) => {
  const dialog = semanticModel.dialogs?.[dialogName];

  // Context menu state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  // Inline rename state
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
  }, []);

  const handleMenuClose = useCallback(() => {
    setMenuAnchor(null);
  }, []);

  const handleMenuDelete = useCallback(() => {
    handleMenuClose();
    onDeleteDialog?.(dialogName);
  }, [dialogName, onDeleteDialog, handleMenuClose]);

  const handleMenuRename = useCallback(() => {
    handleMenuClose();
    if (onRenameDialog) {
      onRenameDialog(dialogName);
    } else {
      // Fallback: start inline edit
      setEditValue(dialogName);
      setEditError(null);
      setIsEditing(true);
    }
  }, [dialogName, onRenameDialog, handleMenuClose]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditValue(dialogName);
    setEditError(null);
    setIsEditing(true);
  }, [dialogName]);

  const validateName = useCallback((name: string): string | null => {
    if (!name.trim()) return 'Name cannot be empty';
    if (!IDENTIFIER_PATTERN.test(name.trim())) {
      return 'Name must be a valid identifier (letters, digits, underscores; cannot start with a digit)';
    }
    if (name.trim() === dialogName) return null; // unchanged is fine
    if (semanticModel.dialogs?.[name.trim()]) {
      return `A dialog named "${name.trim()}" already exists`;
    }
    return null;
  }, [dialogName, semanticModel.dialogs]);

  const commitRename = useCallback(() => {
    const newName = editValue.trim();
    const err = validateName(newName);
    if (err) {
      setEditError(err);
      return;
    }
    setIsEditing(false);
    if (newName !== dialogName) {
      onRenameDialog?.(dialogName);
    }
  }, [editValue, dialogName, validateName, onRenameDialog]);

  const cancelRename = useCallback(() => {
    setIsEditing(false);
    setEditError(null);
  }, []);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }, [commitRename, cancelRename]);

  if (!dialog) return null;

  const infoFunc = dialog.properties?.information as any;
  const infoFuncName = typeof infoFunc === 'string' ? infoFunc : infoFunc?.name;

  return (
    <Box style={style} onContextMenu={handleContextMenu}>
      <ListItemButton
        selected={isSelected}
        onClick={() => {
          if (!isEditing) {
            onSelectDialog(dialogName, infoFuncName);
          }
        }}
        onDoubleClick={handleDoubleClick}
        sx={(theme) => ({ ...searchablePaneRowButtonSx(theme), pr: 1, height: '100%' })}
      >
        {hasChildren ? (
          <Tooltip title={isExpanded ? 'Collapse' : 'Expand'}>
            <IconButton
              size='small'
              onClick={(e) => {
                e.stopPropagation();
                onToggleDialogExpand(dialogName);
              }}
              sx={{ width: 32, height: 32, mr: 0.5, flexShrink: 0 }}
              aria-label={isExpanded ? 'Collapse dialog' : 'Expand dialog'}
            >
              {isExpanded ? <ExpandMoreIcon fontSize='small' /> : <ChevronRightIcon fontSize='small' />}
            </IconButton>
          </Tooltip>
        ) : (
          <Box sx={{ width: 32, height: 32, mr: 0.5, flexShrink: 0 }} />
        )}
        {isEditing ? (
          <TextField
            inputRef={inputRef}
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value);
              setEditError(validateName(e.target.value));
            }}
            onKeyDown={handleEditKeyDown}
            onBlur={cancelRename}
            error={!!editError}
            helperText={editError ?? undefined}
            size='small'
            variant='standard'
            fullWidth
            onClick={(e) => e.stopPropagation()}
            sx={{ flexGrow: 1 }}
          />
        ) : (
          <ListItemText
            primary={dialog.properties?.description || dialogName}
            secondary={dialogName}
            primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: isExpanded ? 600 : 400, noWrap: true }}
            secondaryTypographyProps={{ fontSize: '0.75rem', noWrap: true }}
          />
        )}
      </ListItemButton>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <MenuItem onClick={handleMenuRename} dense>
          Rename Dialog...
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleMenuDelete} dense sx={{ color: 'error.main' }}>
          Delete Dialog...
        </MenuItem>
      </Menu>
    </Box>
  );
}, (prev, next) => {
  if (prev.dialogName !== next.dialogName) return false;

  const prevDialog = prev.semanticModel.dialogs?.[prev.dialogName];
  const nextDialog = next.semanticModel.dialogs?.[next.dialogName];

  if (!prevDialog && !nextDialog) {
    // both undefined
  } else if (!prevDialog || !nextDialog) {
    return false;
  } else {
    if (prevDialog.properties?.description !== nextDialog.properties?.description) return false;

    const prevInfo = prevDialog.properties?.information;
    const nextInfo = nextDialog.properties?.information;

    if (prevInfo !== nextInfo) {
      const prevName = typeof prevInfo === 'object' ? (prevInfo as any)?.name : prevInfo;
      const nextName = typeof nextInfo === 'object' ? (nextInfo as any)?.name : nextInfo;
      if (prevName !== nextName) return false;
    }
  }

  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isExpanded !== next.isExpanded) return false;
  if (prev.hasChildren !== next.hasChildren) return false;
  if (prev.style !== next.style) return false;
  if (prev.onDeleteDialog !== next.onDeleteDialog) return false;
  if (prev.onRenameDialog !== next.onRenameDialog) return false;

  return true;
});

DialogTreeItem.displayName = 'DialogTreeItem';

export default DialogTreeItem;
export type { DialogTreeItemProps };
