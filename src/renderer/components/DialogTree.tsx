import React, { useMemo } from 'react';
import {
  Paper,
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  IconButton,
  TextField,
  InputAdornment
} from '@mui/material';
import {
  CallSplit as CallSplitIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  FilterList as FilterListIcon
} from '@mui/icons-material';
import { DialogTreeProps } from './dialogTypes';
import { useSearchStore } from '../store/searchStore';

const DialogTree: React.FC<DialogTreeProps> = ({
  selectedNPC,
  dialogsForNPC,
  semanticModel,
  selectedDialog,
  selectedFunctionName,
  expandedDialogs,
  expandedChoices,
  onSelectDialog,
  onToggleDialogExpand,
  onToggleChoiceExpand,
  buildFunctionTree
}) => {
  const { dialogFilter, setDialogFilter, filterDialogs } = useSearchStore();

  // Recursive function to render choice subtree
  const renderChoiceTree = (choice: any, depth: number = 1, index: number = 0, dialogName: string): React.ReactNode => {
    if (!choice.subtree) return null;
    const isSelected = selectedFunctionName === choice.targetFunction;
    const hasSubchoices = choice.subtree.children && choice.subtree.children.length > 0;
    const choiceKey = `${choice.targetFunction}-${depth}-${index}`;
    const isExpanded = expandedChoices.has(choiceKey);

    return (
      <Box key={choiceKey}>
        <ListItemButton
          selected={isSelected}
          onClick={() => {
            onSelectDialog(dialogName, choice.targetFunction);
          }}
          sx={{ pl: (depth + 1) * 2, pr: 1 }}
        >
          {hasSubchoices ? (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onToggleChoiceExpand(choiceKey);
              }}
              sx={{ width: 28, height: 28, mr: 0.5, flexShrink: 0 }}
            >
              {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
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
        {isExpanded && hasSubchoices && choice.subtree.children.map((subchoice: any, idx: number) =>
          renderChoiceTree(subchoice, depth + 1, idx, dialogName)
        )}
      </Box>
    );
  };

  // Sort dialogs by priority (nr field)
  const sortedDialogs = useMemo(() => {
    return [...dialogsForNPC].sort((a, b) => {
      const dialogA = semanticModel.dialogs?.[a];
      const dialogB = semanticModel.dialogs?.[b];

      // Safety check: skip sorting if dialogs or properties are missing
      if (!dialogA || !dialogB) return 0;

      const priorityA = typeof dialogA.properties?.nr === 'number' ? dialogA.properties.nr : 999999;
      const priorityB = typeof dialogB.properties?.nr === 'number' ? dialogB.properties.nr : 999999;
      return priorityA - priorityB;
    });
  }, [dialogsForNPC, semanticModel.dialogs]);

  // Filter dialogs based on the current filter
  const filteredDialogs = useMemo(() => {
    return filterDialogs(sortedDialogs);
  }, [sortedDialogs, filterDialogs, dialogFilter]);

  return (
    <Paper sx={{ width: 350, overflow: 'hidden', borderRadius: 0, borderLeft: 1, borderRight: 1, borderColor: 'divider', flexShrink: 0, display: 'flex', flexDirection: 'column' }} elevation={1}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Typography variant="h6">Dialogs</Typography>
        {selectedNPC && (
          <Typography variant="caption" color="text.secondary">
            {selectedNPC} - {filteredDialogs.length} of {dialogsForNPC.length} shown
          </Typography>
        )}
      </Box>
      {selectedNPC && (
        <Box sx={{ px: 1, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Filter dialogs..."
            value={dialogFilter}
            onChange={(e) => setDialogFilter(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <FilterListIcon fontSize="small" color="action" />
                </InputAdornment>
              )
            }}
          />
        </Box>
      )}
      <List dense sx={{ overflow: 'auto', flexGrow: 1 }}>
        {selectedNPC ? (
          <>
            {filteredDialogs.map((dialogName) => {
              const dialog = semanticModel.dialogs?.[dialogName];

              // Safety check: skip rendering if dialog is missing
              if (!dialog) return null;

              const infoFunc = dialog.properties?.information as any;
              const infoFuncName = typeof infoFunc === 'string' ? infoFunc : infoFunc?.name;
              const infoFuncData = infoFuncName ? semanticModel.functions?.[infoFuncName] : null;
              const isExpanded = expandedDialogs.has(dialogName);

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
                <Box key={dialogName}>
                  <ListItemButton
                    selected={selectedDialog === dialogName && selectedFunctionName === infoFuncName}
                    onClick={() => {
                      onSelectDialog(dialogName, infoFuncName);
                    }}
                    sx={{ pr: 1 }}
                  >
                    {hasChoices ? (
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleDialogExpand(dialogName);
                        }}
                        sx={{ width: 32, height: 32, mr: 0.5, flexShrink: 0 }}
                      >
                        {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                      </IconButton>
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
                  {isExpanded && hasChoices && functionTree?.children?.map((choice: any, idx: number) =>
                    renderChoiceTree(choice, 1, idx, dialogName)
                  )}
                </Box>
              );
            })}
            {filteredDialogs.length === 0 && dialogFilter && (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  No dialogs match "{dialogFilter}"
                </Typography>
              </Box>
            )}
          </>
        ) : (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Select an NPC to view dialogs
            </Typography>
          </Box>
        )}
      </List>
    </Paper>
  );
};

export default DialogTree;
