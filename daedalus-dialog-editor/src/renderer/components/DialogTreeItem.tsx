import React, { memo, CSSProperties } from 'react';
import {
  Box,
  ListItemButton,
  ListItemText,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon
} from '@mui/icons-material';
import type { SemanticModel } from '../types/global';

interface DialogTreeItemProps {
  dialogName: string;
  semanticModel: SemanticModel;
  isSelected: boolean;
  isExpanded: boolean;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleDialogExpand: (dialogName: string) => void;
  hasChildren: boolean;
  style: CSSProperties;
}

const DialogTreeItem = memo(({
  dialogName,
  semanticModel,
  isSelected,
  isExpanded,
  onSelectDialog,
  onToggleDialogExpand,
  hasChildren,
  style
}: DialogTreeItemProps) => {
  const dialog = semanticModel.dialogs?.[dialogName];

  // Safety check: skip rendering if dialog is missing
  if (!dialog) return null;

  const infoFunc = dialog.properties?.information as any;
  const infoFuncName = typeof infoFunc === 'string' ? infoFunc : infoFunc?.name;

  return (
    <Box style={style}>
      <ListItemButton
        selected={isSelected}
        onClick={() => {
          onSelectDialog(dialogName, infoFuncName);
        }}
        sx={{ pr: 1, height: '100%' }}
      >
        {hasChildren ? (
          <Tooltip title={isExpanded ? 'Collapse' : 'Expand'}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onToggleDialogExpand(dialogName);
              }}
              sx={{ width: 32, height: 32, mr: 0.5, flexShrink: 0 }}
              aria-label={isExpanded ? 'Collapse dialog' : 'Expand dialog'}
            >
              {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        ) : (
          <Box sx={{ width: 32, height: 32, mr: 0.5, flexShrink: 0 }} />
        )}
        <ListItemText
          primary={dialog.properties?.description || dialogName}
          secondary={dialogName}
          primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: isExpanded ? 600 : 400, noWrap: true }}
          secondaryTypographyProps={{ fontSize: '0.75rem', noWrap: true }}
        />
      </ListItemButton>
    </Box>
  );
}, (prev, next) => {
  if (prev.dialogName !== next.dialogName) return false;

  // Optimization: specific check for relevant semantic model parts
  const prevDialog = prev.semanticModel.dialogs?.[prev.dialogName];
  const nextDialog = next.semanticModel.dialogs?.[next.dialogName];

  // Check for deep equality of relevant properties because semanticModel reference
  // often changes due to worker serialization, breaking simple reference equality.
  if (!prevDialog && !nextDialog) {
    // Both missing, effectively equal
  } else if (!prevDialog || !nextDialog) {
    return false; // One missing, one present -> changed
  } else {
    // Both exist, check relevant properties used in render
    if (prevDialog.properties?.description !== nextDialog.properties?.description) return false;

    // Check information function name
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

  // Check style (positioning)
  if (prev.style !== next.style) return false;

  return true;
});

DialogTreeItem.displayName = 'DialogTreeItem';

export default DialogTreeItem;
