import React, { memo, CSSProperties } from 'react';
import {
  Box,
  ListItemButton,
  ListItemText,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  CallSplit as CallSplitIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon
} from '@mui/icons-material';
import type { FunctionTreeChild } from '../types/global';

interface ChoiceTreeItemProps {
  choice: FunctionTreeChild;
  depth: number;
  index: number;
  choiceKey: string;
  isExpanded: boolean;
  hasChildren: boolean;
  selectedFunctionName: string | null;
  dialogName: string;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleChoiceExpand: (choiceKey: string) => void;
  style: CSSProperties;
}

const ChoiceTreeItem = memo(({
  choice,
  depth,
  index,
  choiceKey,
  isExpanded,
  hasChildren,
  selectedFunctionName,
  dialogName,
  onSelectDialog,
  onToggleChoiceExpand,
  style
}: ChoiceTreeItemProps) => {
  const isChoiceSelected = selectedFunctionName === choice.targetFunction;

  return (
    <Box style={style}>
      <ListItemButton
        selected={isChoiceSelected}
        onClick={() => {
          onSelectDialog(dialogName, choice.targetFunction);
        }}
        sx={{ pl: (depth + 1) * 2, pr: 1, height: '100%' }}
      >
        {hasChildren ? (
          <Tooltip title={isExpanded ? 'Collapse' : 'Expand'}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onToggleChoiceExpand(choiceKey);
              }}
              sx={{ width: 28, height: 28, mr: 0.5, flexShrink: 0 }}
              aria-label={isExpanded ? 'Collapse choice' : 'Expand choice'}
            >
              {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        ) : (
          <Box sx={{ width: 28, height: 28, mr: 0.5, flexShrink: 0 }} />
        )}
        <CallSplitIcon fontSize="small" sx={{ mr: 1, fontSize: '1rem', color: 'text.secondary', flexShrink: 0 }} />
        <ListItemText
          primary={choice.text}
          secondary={choice.targetFunction}
          primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }}
          secondaryTypographyProps={{ fontSize: '0.7rem', noWrap: true }}
        />
      </ListItemButton>
    </Box>
  );
}, (prev, next) => {
  if (prev.choice !== next.choice) return false;
  if (prev.depth !== next.depth) return false;
  if (prev.choiceKey !== next.choiceKey) return false;
  if (prev.isExpanded !== next.isExpanded) return false;
  if (prev.hasChildren !== next.hasChildren) return false;
  if (prev.selectedFunctionName !== next.selectedFunctionName) return false;
  if (prev.dialogName !== next.dialogName) return false;
  if (prev.style !== next.style) return false;

  return true;
});

ChoiceTreeItem.displayName = 'ChoiceTreeItem';

export default ChoiceTreeItem;
