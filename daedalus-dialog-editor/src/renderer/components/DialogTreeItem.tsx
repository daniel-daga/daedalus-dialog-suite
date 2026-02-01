import React, { memo } from 'react';
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
import type { SemanticModel, FunctionTreeNode } from '../types/global';
import ChoiceTreeItem from './ChoiceTreeItem';

interface DialogTreeItemProps {
  dialogName: string;
  semanticModel: SemanticModel;
  isSelected: boolean;
  isExpanded: boolean;
  expandedChoices: Set<string>;
  selectedFunctionName: string | null;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleDialogExpand: (dialogName: string) => void;
  onToggleChoiceExpand: (choiceKey: string) => void;
  buildFunctionTree: (funcName: string, ancestorPath?: string[]) => FunctionTreeNode | null;
}

const DialogTreeItem = memo(({
  dialogName,
  semanticModel,
  isSelected,
  isExpanded,
  expandedChoices,
  selectedFunctionName,
  onSelectDialog,
  onToggleDialogExpand,
  onToggleChoiceExpand,
  buildFunctionTree
}: DialogTreeItemProps) => {
  const dialog = semanticModel.dialogs?.[dialogName];

  // Safety check: skip rendering if dialog is missing
  if (!dialog) return null;

  const infoFunc = dialog.properties?.information as any;
  const infoFuncName = typeof infoFunc === 'string' ? infoFunc : infoFunc?.name;
  const infoFuncData = infoFuncName ? semanticModel.functions?.[infoFuncName] : null;

  // Optimization: Only build deep tree if expanded. Otherwise verify if function has potential choices.
  let functionTree = null;
  let hasChoices = false;

  if (isExpanded) {
    functionTree = infoFuncName ? buildFunctionTree(infoFuncName) : null;
    hasChoices = !!(functionTree && functionTree.children && functionTree.children.length > 0);
  } else if (infoFuncData && infoFuncData.actions) {
    // Shallow check for existence of choice actions
    hasChoices = infoFuncData.actions.some((a: any) => 'dialogRef' in a && 'targetFunction' in a);
  }

  return (
    <Box>
      <ListItemButton
        selected={isSelected}
        onClick={() => {
          onSelectDialog(dialogName, infoFuncName);
        }}
        sx={{ pr: 1 }}
      >
        {hasChoices ? (
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
          primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: isExpanded ? 600 : 400 }}
          secondaryTypographyProps={{ fontSize: '0.75rem' }}
        />
      </ListItemButton>
      {isExpanded && hasChoices && functionTree?.children?.map((choice: any, idx: number) => (
        <ChoiceTreeItem
          key={`${choice.targetFunction}-1-${idx}`}
          choice={choice}
          depth={1}
          index={idx}
          expandedChoices={expandedChoices}
          selectedFunctionName={selectedFunctionName}
          dialogName={dialogName}
          onSelectDialog={onSelectDialog}
          onToggleChoiceExpand={onToggleChoiceExpand}
        />
      ))}
    </Box>
  );
}, (prev, next) => {
  if (prev.dialogName !== next.dialogName) return false;
  if (prev.semanticModel !== next.semanticModel) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isExpanded !== next.isExpanded) return false;
  if (prev.selectedFunctionName !== next.selectedFunctionName) return false;

  // Optimization: If collapsed, ignore expandedChoices changes
  if (!next.isExpanded && !prev.isExpanded) return true;

  // If expanded, check expandedChoices equality
  // Note: Set equality check by reference. If Set is recreated, it returns false.
  // This is expected behavior for expanded items to pick up potential deep changes.
  if (prev.expandedChoices !== next.expandedChoices) return false;

  return true;
});

DialogTreeItem.displayName = 'DialogTreeItem';

export default DialogTreeItem;
