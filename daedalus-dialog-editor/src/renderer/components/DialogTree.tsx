import React, { useMemo, memo } from 'react';
import {
  Paper,
  Box,
  Typography,
  TextField,
  InputAdornment,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button
} from '@mui/material';
import {
  FilterList as FilterListIcon,
  Clear as ClearIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { DialogTreeProps } from './dialogTypes';
import { useSearchStore } from '../store/searchStore';
import DialogTreeItem from './DialogTreeItem';
import ChoiceTreeItem from './ChoiceTreeItem';
import { flattenDialogs } from './dialogTreeUtils';
import type { SemanticModel } from '../types/global';
import {
  SEARCHABLE_PANE_PATTERN,
  searchablePaneContentSx,
  searchablePaneFilterStripSx,
  searchablePaneHeaderSx,
  searchablePaneShellSx,
  searchablePaneTextFieldSx
} from './common/searchablePaneStyles';

interface ItemData {
  flatItems: any[];
  semanticModel: SemanticModel;
  selectedDialog: string | null;
  selectedFunctionName: string | null;
  onSelectDialog: (dialogName: string, functionName: string | null) => void;
  onToggleDialogExpand: (dialogName: string) => void;
  onToggleChoiceExpand: (choiceKey: string) => void;
}

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
  }

  return (
    <ChoiceTreeItem
      choice={item.choice}
      depth={item.depth}
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
  buildFunctionTree,
  onAddDialog
}) => {
  const { dialogFilter, setDialogFilter, filterDialogs } = useSearchStore();
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [newDialogName, setNewDialogName] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  const sortedDialogs = useMemo(() => {
    return [...dialogsForNPC].sort((a, b) => {
      const dialogA = semanticModel.dialogs?.[a];
      const dialogB = semanticModel.dialogs?.[b];

      if (!dialogA || !dialogB) return 0;

      const priorityA = typeof dialogA.properties?.nr === 'number' ? dialogA.properties.nr : 999999;
      const priorityB = typeof dialogB.properties?.nr === 'number' ? dialogB.properties.nr : 999999;
      return priorityA - priorityB;
    });
  }, [dialogsForNPC, semanticModel.dialogs]);

  const filteredDialogs = useMemo(() => {
    return filterDialogs(sortedDialogs);
  }, [sortedDialogs, filterDialogs, dialogFilter]);

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

  const handleOpenCreateDialog = () => {
    const defaultName = selectedNPC ? `DIA_${selectedNPC}_Start` : '';
    setNewDialogName(defaultName);
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handleCreateDialog = async () => {
    const dialogName = newDialogName.trim();
    if (!dialogName || !onAddDialog) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      await onAddDialog(dialogName);
      setIsCreateOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create dialog.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Paper
      data-ui-pattern={SEARCHABLE_PANE_PATTERN}
      sx={(theme) => ({ ...searchablePaneShellSx(theme), width: 350, flexShrink: 0, height: '100%', borderLeft: 1, borderRight: 1, borderColor: 'divider' })}
      elevation={1}
    >
      <Box sx={searchablePaneHeaderSx}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant='h6'>Dialogs</Typography>
          <Tooltip title={selectedNPC ? 'Add Dialog' : 'Select an NPC first'}>
            <span>
              <IconButton
                size='small'
                aria-label='Add Dialog'
                onClick={handleOpenCreateDialog}
                disabled={!selectedNPC || !onAddDialog}
              >
                <AddIcon fontSize='small' />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        {selectedNPC && (
          <Typography variant='caption' color='text.secondary'>
            {selectedNPC} - {filteredDialogs.length} of {dialogsForNPC.length} shown
          </Typography>
        )}
      </Box>

      {selectedNPC && (
        <Box sx={searchablePaneFilterStripSx}>
          <TextField
            size='small'
            fullWidth
            placeholder='Filter dialogs...'
            value={dialogFilter}
            onChange={(e) => setDialogFilter(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position='start'>
                  <FilterListIcon fontSize='small' color='action' />
                </InputAdornment>
              ),
              endAdornment: dialogFilter ? (
                <InputAdornment position='end'>
                  <IconButton
                    size='small'
                    onClick={() => setDialogFilter('')}
                    aria-label='Clear filter'
                  >
                    <ClearIcon fontSize='small' />
                  </IconButton>
                </InputAdornment>
              ) : null
            }}
            sx={searchablePaneTextFieldSx}
          />
        </Box>
      )}

      <Dialog open={isCreateOpen} onClose={() => !isCreating && setIsCreateOpen(false)} fullWidth maxWidth='sm'>
        <DialogTitle>Create Dialog</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin='dense'
            fullWidth
            label='Dialog Name'
            placeholder='DIA_MyNpc_NewDialog'
            value={newDialogName}
            onChange={(e) => setNewDialogName(e.target.value)}
            disabled={isCreating}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreateDialog();
              }
            }}
          />
          {createError && (
            <Typography variant='caption' color='error' sx={{ mt: 1, display: 'block' }}>
              {createError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsCreateOpen(false)} disabled={isCreating}>Cancel</Button>
          <Button
            onClick={() => void handleCreateDialog()}
            variant='contained'
            disabled={!newDialogName.trim() || isCreating}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={searchablePaneContentSx}>
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
              <Typography variant='body2' color='text.secondary'>
                {dialogFilter ? `No dialogs match "${dialogFilter}"` : 'No dialogs available'}
              </Typography>
            </Box>
          )
        ) : (
          <Box sx={{ p: 2 }}>
            <Typography variant='body2' color='text.secondary'>
              Select an NPC to view dialogs
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default DialogTree;

