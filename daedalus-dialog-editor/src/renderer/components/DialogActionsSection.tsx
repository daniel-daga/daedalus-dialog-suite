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
import type { DialogFunction, SemanticModel } from '../types/global';

interface DialogActionsSectionProps {
  dialogName: string;
  currentFunction: DialogFunction;
  npcName: string;
  actionRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  updateAction: (index: number, updatedAction: any) => void;
  deleteAction: (index: number) => void;
  deleteActionAndFocusPrev: (index: number) => void;
  addDialogLineAfter: (index: number, toggleSpeaker?: boolean) => void;
  addActionAfter: (index: number, actionType: string) => void;
  focusAction: (index: number, scrollIntoView?: boolean) => void;
  semanticModel?: SemanticModel;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction: (oldName: string, newName: string) => void;
  onAddActionToEnd: (actionType: ActionTypeId) => void;
}

const EXTRA_ACTION_ITEMS: Array<{ actionType: ActionTypeId; label: string }> = [
  { actionType: 'logEntry', label: 'Add Log Entry' },
  { actionType: 'createTopic', label: 'Add Create Topic' },
  { actionType: 'logSetTopicStatus', label: 'Add Log Set Status' },
  { actionType: 'createInventoryItems', label: 'Add Create Inventory Items' },
  { actionType: 'giveInventoryItems', label: 'Add Give Inventory Items' },
  { actionType: 'attackAction', label: 'Add Attack Action' },
  { actionType: 'setAttitudeAction', label: 'Add Set Attitude' },
  { actionType: 'chapterTransition', label: 'Add Chapter Transition' },
  { actionType: 'exchangeRoutine', label: 'Add Exchange Routine' },
  { actionType: 'customAction', label: 'Add Custom Action' }
];

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
          <Button
            startIcon={<AddIcon />}
            size="small"
            variant="outlined"
            onClick={() => onAddActionToEnd('dialogLine')}
          >
            Add Line
          </Button>
          <Button
            startIcon={<AddIcon />}
            size="small"
            variant="outlined"
            onClick={() => onAddActionToEnd('choice')}
          >
            Add Choice
          </Button>
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
            {EXTRA_ACTION_ITEMS.map((item) => (
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
