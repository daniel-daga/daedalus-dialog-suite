import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Button,
  IconButton,
  Tooltip,
  Menu,
  MenuItem
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreVertIcon
} from '@mui/icons-material';
import ActionsList from './ActionsList';
import type { ActionTypeId } from './actionTypes';
import type { DialogAction, DialogFunction, SemanticModel } from '../types/global';

interface DialogActionsSectionProps {
  dialogName: string;
  currentFunction: DialogFunction;
  npcName: string;
  actionRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  updateAction: (index: number, updatedAction: DialogAction) => void;
  deleteAction: (index: number) => void;
  deleteActionAndFocusPrev: (index: number) => void;
  addDialogLineAfter: (index: number, toggleSpeaker?: boolean) => void;
  addActionAfter: (index: number, actionType: ActionTypeId) => void;
  focusAction: (index: number, scrollIntoView?: boolean) => void;
  semanticModel?: SemanticModel;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction: (oldName: string, newName: string) => void;
  onAddActionToEnd: (actionType: ActionTypeId) => void;
}

type AddActionItem = {
  actionType: ActionTypeId;
  label: string;
  placement: 'primary' | 'menu';
};

const ADD_ACTION_ITEMS: AddActionItem[] = [
  { actionType: 'dialogLine', label: 'Add Line', placement: 'primary' },
  { actionType: 'choice', label: 'Add Choice', placement: 'primary' },
  { actionType: 'logEntry', label: 'Add Log Entry', placement: 'menu' },
  { actionType: 'createTopic', label: 'Add Create Topic', placement: 'menu' },
  { actionType: 'logSetTopicStatus', label: 'Add Log Set Status', placement: 'menu' },
  { actionType: 'createInventoryItems', label: 'Add Create Inventory Items', placement: 'menu' },
  { actionType: 'giveInventoryItems', label: 'Add Give Inventory Items', placement: 'menu' },
  { actionType: 'attackAction', label: 'Add Attack Action', placement: 'menu' },
  { actionType: 'setAttitudeAction', label: 'Add Set Attitude', placement: 'menu' },
  { actionType: 'chapterTransition', label: 'Add Chapter Transition', placement: 'menu' },
  { actionType: 'exchangeRoutine', label: 'Add Exchange Routine', placement: 'menu' },
  { actionType: 'customAction', label: 'Add Custom Action', placement: 'menu' }
];

const PRIMARY_ACTION_ITEMS = ADD_ACTION_ITEMS.filter((item) => item.placement === 'primary');
const MENU_ACTION_ITEMS = ADD_ACTION_ITEMS.filter((item) => item.placement === 'menu');

const DialogActionsSection: React.FC<DialogActionsSectionProps> = ({
  dialogName,
  currentFunction,
  npcName,
  actionRefs,
  updateAction,
  deleteAction,
  deleteActionAndFocusPrev,
  addDialogLineAfter,
  addActionAfter,
  focusAction,
  semanticModel,
  onNavigateToFunction,
  onRenameFunction,
  onAddActionToEnd
}) => {
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6">{currentFunction.name || 'Dialog Actions'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {(currentFunction.actions || []).length} action(s)
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {PRIMARY_ACTION_ITEMS.map((item) => (
            <Button
              key={item.actionType}
              startIcon={<AddIcon />}
              size="small"
              variant="outlined"
              onClick={() => onAddActionToEnd(item.actionType)}
            >
              {item.label}
            </Button>
          ))}
          <Tooltip title="More actions">
            <IconButton
              size="small"
              onClick={(event) => setAddMenuAnchor(event.currentTarget)}
              sx={{ ml: 0.5 }}
              aria-label="More actions"
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={addMenuAnchor}
            open={Boolean(addMenuAnchor)}
            onClose={() => setAddMenuAnchor(null)}
          >
            {MENU_ACTION_ITEMS.map((item) => (
              <MenuItem
                key={item.actionType}
                onClick={() => {
                  onAddActionToEnd(item.actionType);
                  setAddMenuAnchor(null);
                }}
              >
                {item.label}
              </MenuItem>
            ))}
          </Menu>
        </Stack>
      </Box>

      {(currentFunction.actions || []).length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No dialog actions yet. Use the buttons above to add actions.
        </Typography>
      ) : (
        <ActionsList
          actions={currentFunction.actions || []}
          actionRefs={actionRefs}
          npcName={npcName}
          updateAction={updateAction}
          deleteAction={deleteAction}
          focusAction={focusAction}
          addDialogLineAfter={addDialogLineAfter}
          deleteActionAndFocusPrev={deleteActionAndFocusPrev}
          addActionAfter={addActionAfter}
          semanticModel={semanticModel}
          onNavigateToFunction={onNavigateToFunction}
          onRenameFunction={onRenameFunction}
          dialogContextName={dialogName}
          contextId={currentFunction.name}
        />
      )}
    </Paper>
  );
};

export default DialogActionsSection;
