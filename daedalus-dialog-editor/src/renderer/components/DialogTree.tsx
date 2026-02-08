import React, { useMemo, memo } from 'react';
import {
  Paper,
  Box,
  Typography,
  TextField,
  InputAdornment,
  IconButton
} from '@mui/material';
import {
  FilterList as FilterListIcon,
  Clear as ClearIcon
} from '@mui/icons-material';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { DialogTreeProps } from './dialogTypes';
import { useSearchStore } from '../store/searchStore';
import DialogTreeItem from './DialogTreeItem';
import ChoiceTreeItem from './ChoiceTreeItem';
import { flattenDialogs } from './dialogTreeUtils';
import type { SemanticModel } from '../types/global';

// Interface for item data passed to the virtualized list
interface ItemData {
  flatItems: any[];
  semanticModel: SemanticModel;
  selectedDialog: string | null;
  selectedFunctionName: string | null;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleDialogExpand: (dialogName: string) => void;
  onToggleChoiceExpand: (choiceKey: string) => void;
}

// Row component defined outside to prevent recreation
// Wrapped in memo to prevent unnecessary re-renders if itemData hasn't changed relevantly
const Row = memo(({ index, style, data }: ListChildComponentProps<ItemData>) => {
  const {
    flatItems,
    semanticModel,
    selectedDialog,
    selectedFunctionName,
    onSelectDialog,
    onToggleDialogExpand,
    onToggleChoiceExpand
  } = data;

  const item = flatItems[index];

  if (item.type === 'dialog') {
    const infoFunc = semanticModel.dialogs?.[item.dialogName]?.properties?.information as any;
    const infoFuncName = typeof infoFunc === 'string' ? infoFunc : infoFunc?.name;

    return (
      <DialogTreeItem
        dialogName={item.dialogName}
        semanticModel={semanticModel}
        isSelected={selectedDialog === item.dialogName && selectedFunctionName === infoFuncName}
        isExpanded={item.isExpanded}
        onSelectDialog={onSelectDialog}
        onToggleDialogExpand={onToggleDialogExpand}
        hasChildren={item.hasChildren}
        style={style}
      />
    );
  } else {
    return (
      <ChoiceTreeItem
        choice={item.choice}
        depth={item.depth}
        index={item.index}
        choiceKey={item.id}
        isExpanded={item.isExpanded}
        hasChildren={item.hasChildren}
        selectedFunctionName={selectedFunctionName}
        dialogName={item.dialogName}
        onSelectDialog={onSelectDialog}
        onToggleChoiceExpand={onToggleChoiceExpand}
        style={style}
      />
    );
  }
});

Row.displayName = 'DialogTreeRow';

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

  // Flatten the dialogs and choices into a single list
  const flatItems = useMemo(() => {
    if (!selectedNPC) return [];
    return flattenDialogs(
      filteredDialogs,
      semanticModel,
      expandedDialogs,
      expandedChoices,
      buildFunctionTree
    );
  }, [selectedNPC, filteredDialogs, semanticModel, expandedDialogs, expandedChoices, buildFunctionTree]);

  // Memoize item data to pass to the list
  const itemData = useMemo(() => ({
    flatItems,
    semanticModel,
    selectedDialog,
    selectedFunctionName,
    onSelectDialog,
    onToggleDialogExpand,
    onToggleChoiceExpand
  }), [
    flatItems,
    semanticModel,
    selectedDialog,
    selectedFunctionName,
    onSelectDialog,
    onToggleDialogExpand,
    onToggleChoiceExpand
  ]);

  return (
    <Paper sx={{ width: 350, overflow: 'hidden', borderRadius: 0, borderLeft: 1, borderRight: 1, borderColor: 'divider', flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%' }} elevation={1}>
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
              ),
              endAdornment: dialogFilter ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setDialogFilter('')}
                    aria-label="Clear filter"
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null
            }}
          />
        </Box>
      )}

      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
        {selectedNPC ? (
          flatItems.length > 0 ? (
            <AutoSizer>
              {({ height, width }: { height: number; width: number }) => (
                <List
                  height={height}
                  itemCount={flatItems.length}
                  itemSize={60}
                  itemData={itemData}
                  width={width}
                  overscanCount={5}
                >
                  {Row}
                </List>
              )}
            </AutoSizer>
          ) : (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                 {dialogFilter ? `No dialogs match "${dialogFilter}"` : 'No dialogs available'}
              </Typography>
            </Box>
          )
        ) : (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Select an NPC to view dialogs
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default DialogTree;
