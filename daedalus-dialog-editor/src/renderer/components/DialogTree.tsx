import React, { useMemo } from 'react';
import {
  Paper,
  Box,
  Typography,
  List,
  TextField,
  InputAdornment
} from '@mui/material';
import {
  FilterList as FilterListIcon
} from '@mui/icons-material';
import { DialogTreeProps } from './dialogTypes';
import { useSearchStore } from '../store/searchStore';
import DialogTreeItem from './DialogTreeItem';

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
              if (!dialog) return null;

              const infoFunc = dialog.properties?.information as any;
              const infoFuncName = typeof infoFunc === 'string' ? infoFunc : infoFunc?.name;

              return (
                <DialogTreeItem
                  key={dialogName}
                  dialogName={dialogName}
                  semanticModel={semanticModel}
                  isSelected={selectedDialog === dialogName && selectedFunctionName === infoFuncName}
                  isExpanded={expandedDialogs.has(dialogName)}
                  expandedChoices={expandedChoices}
                  selectedFunctionName={selectedFunctionName}
                  onSelectDialog={onSelectDialog}
                  onToggleDialogExpand={onToggleDialogExpand}
                  onToggleChoiceExpand={onToggleChoiceExpand}
                  buildFunctionTree={buildFunctionTree}
                />
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
