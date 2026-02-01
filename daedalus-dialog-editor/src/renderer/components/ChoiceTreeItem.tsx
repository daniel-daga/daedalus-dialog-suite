import React, { memo } from 'react';
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

interface ChoiceTreeItemProps {
  choice: any; // Using any as in DialogTreeItem, but ideally should be FunctionTreeChild
  depth: number;
  index: number;
  expandedChoices: Set<string>;
  selectedFunctionName: string | null;
  dialogName: string; // Needed for onSelectDialog
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleChoiceExpand: (choiceKey: string) => void;
}

const ChoiceTreeItem = memo(({
  choice,
  depth,
  index,
  expandedChoices,
  selectedFunctionName,
  dialogName,
  onSelectDialog,
  onToggleChoiceExpand
}: ChoiceTreeItemProps) => {
  const isChoiceSelected = selectedFunctionName === choice.targetFunction;
  const hasSubchoices = choice.subtree && choice.subtree.children && choice.subtree.children.length > 0;
  const choiceKey = `${choice.targetFunction}-${depth}-${index}`;
  const isChoiceExpanded = expandedChoices.has(choiceKey);

  return (
    <Box>
      <ListItemButton
        selected={isChoiceSelected}
        onClick={() => {
          onSelectDialog(dialogName, choice.targetFunction);
        }}
        sx={{ pl: (depth + 1) * 2, pr: 1 }}
      >
        {hasSubchoices ? (
          <Tooltip title={isChoiceExpanded ? 'Collapse' : 'Expand'}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onToggleChoiceExpand(choiceKey);
              }}
              sx={{ width: 28, height: 28, mr: 0.5, flexShrink: 0 }}
              aria-label={isChoiceExpanded ? 'Collapse choice' : 'Expand choice'}
            >
              {isChoiceExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        ) : (
          <Box sx={{ width: 28, height: 28, mr: 0.5, flexShrink: 0 }} />
        )}
        <CallSplitIcon fontSize="small" sx={{ mr: 1, fontSize: '1rem', color: 'text.secondary', flexShrink: 0 }} />
        <ListItemText
          primary={choice.text}
          secondary={choice.targetFunction}
          primaryTypographyProps={{ fontSize: '0.85rem' }}
          secondaryTypographyProps={{ fontSize: '0.7rem' }}
        />
      </ListItemButton>
      {isChoiceExpanded && hasSubchoices && choice.subtree.children.map((subchoice: any, idx: number) => (
        <ChoiceTreeItem
          key={`${subchoice.targetFunction}-${depth + 1}-${idx}`}
          choice={subchoice}
          depth={depth + 1}
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
  // 1. Check critical props
  if (prev.choice !== next.choice) return false;
  if (prev.depth !== next.depth) return false;
  if (prev.index !== next.index) return false;
  if (prev.dialogName !== next.dialogName) return false;
  if (prev.onSelectDialog !== next.onSelectDialog) return false;
  if (prev.onToggleChoiceExpand !== next.onToggleChoiceExpand) return false;
  if (prev.selectedFunctionName !== next.selectedFunctionName) return false;

  // 2. Check expansion state
  const prevKey = `${prev.choice.targetFunction}-${prev.depth}-${prev.index}`;
  const nextKey = `${next.choice.targetFunction}-${next.depth}-${next.index}`;

  // Key should be stable if choice/depth/index are stable, but good to be safe
  if (prevKey !== nextKey) return false;

  const prevExpanded = prev.expandedChoices.has(prevKey);
  const nextExpanded = next.expandedChoices.has(nextKey);

  // If expansion state changed, we MUST re-render
  if (prevExpanded !== nextExpanded) return false;

  // If we are collapsed (and stayed collapsed), we can IGNORE changes to expandedChoices
  // because they don't affect our rendering (we don't render children)
  if (!nextExpanded) return true;

  // If we are expanded, we MUST re-render to pass the new expandedChoices ref to our children
  // so they can update their own expansion state
  if (prev.expandedChoices !== next.expandedChoices) return false;

  return true;
});

ChoiceTreeItem.displayName = 'ChoiceTreeItem';

export default ChoiceTreeItem;
