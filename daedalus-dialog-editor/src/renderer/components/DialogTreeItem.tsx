import React, { memo, CSSProperties } from 'react';
import {
  Box,
  ListItemButton,
  ListItemText,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { searchablePaneRowButtonSx } from './common/searchablePaneStyles';

void React;

interface DialogTreeItemProps {
  dialogName: string;
  description: string | undefined;
  infoFuncName: string | null;
  isSelected: boolean;
  isExpanded: boolean;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleDialogExpand: (dialogName: string) => void;
  hasChildren: boolean;
  style: CSSProperties;
}

const DialogTreeItem = memo(({
  dialogName,
  description,
  infoFuncName,
  isSelected,
  isExpanded,
  onSelectDialog,
  onToggleDialogExpand,
  hasChildren,
  style,
}: DialogTreeItemProps) => {
  return (
    <Box style={style}>
      <ListItemButton
        selected={isSelected}
        onClick={() => onSelectDialog(dialogName, infoFuncName)}
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
        <ListItemText
          primary={description || dialogName}
          secondary={dialogName}
          primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: isExpanded ? 600 : 400, noWrap: true }}
          secondaryTypographyProps={{ fontSize: '0.75rem', noWrap: true }}
        />
      </ListItemButton>
    </Box>
  );
});

DialogTreeItem.displayName = 'DialogTreeItem';

export default DialogTreeItem;
export type { DialogTreeItemProps };
