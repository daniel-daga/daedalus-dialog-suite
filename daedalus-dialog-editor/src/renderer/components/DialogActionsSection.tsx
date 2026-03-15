import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Tooltip,
  Menu,
  MenuItem
} from '@mui/material';
import {
  Add as AddIcon,
  Chat as ChatIcon,
  CallSplit as CallSplitIcon,
  Description as DescriptionIcon,
  LibraryBooks as LibraryBooksIcon,
  Inventory as InventoryIcon,
  CardGiftcard as CardGiftcardIcon,
  Gavel as GavelIcon,
  EmojiPeople as EmojiPeopleIcon,
  Navigation as NavigationIcon,
  SwapHoriz as SwapHorizIcon,
  Code as CodeIcon,
  Star as StarIcon,
  School as SchoolIcon,
  PersonAdd as PersonAddIcon,
  RemoveShoppingCart as RemoveShoppingCartIcon,
  Inventory2 as Inventory2Icon
} from '@mui/icons-material';
import ActionsList from './ActionsList';
import type { ActionTypeId } from './actionTypes';
import type { DialogAction, DialogFunction, SemanticModel } from '../types/global';
import type { ActionBranchKey, ActionPath } from './nestedActionUtils';

interface DialogActionsSectionProps {
  dialogName: string;
  currentFunction: DialogFunction;
  npcName: string;
  updateActionAtPath: (path: ActionPath, updatedAction: DialogAction) => void;
  deleteActionAtPath: (path: ActionPath) => void;
  deleteActionAndFocusPrevAtPath: (path: ActionPath) => void;
  addDialogLineAfterPath: (path: ActionPath, toggleSpeaker?: boolean) => void;
  addActionAfterPath: (path: ActionPath, actionType: ActionTypeId) => void;
  addActionToBranchEnd: (path: ActionPath, branch: ActionBranchKey, actionType: ActionTypeId) => void;
  moveAction: (pathPrefix: ActionPath, sourceIndex: number, destinationIndex: number) => void;
  focusActionAtPath: (path: ActionPath, scrollIntoView?: boolean) => void;
  registerActionRef: (path: ActionPath, element: HTMLInputElement | null) => void;
  getVisibleActionPaths: () => ActionPath[];
  semanticModel?: SemanticModel;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction: (oldName: string, newName: string) => void;
  onAddActionToEnd: (actionType: ActionTypeId) => void;
}

const ADD_ACTION_ITEMS: { actionType: ActionTypeId; label: string; icon: React.ReactNode }[] = [
  { actionType: 'dialogLine', label: 'Dialog Line', icon: <ChatIcon fontSize="small" /> },
  { actionType: 'choice', label: 'Choice', icon: <CallSplitIcon fontSize="small" /> },
  { actionType: 'logEntry', label: 'Log Entry', icon: <DescriptionIcon fontSize="small" /> },
  { actionType: 'createTopic', label: 'Create Topic', icon: <LibraryBooksIcon fontSize="small" /> },
  { actionType: 'logSetTopicStatus', label: 'Log Set Status', icon: <DescriptionIcon fontSize="small" /> },
  { actionType: 'createInventoryItems', label: 'Create Inventory Items', icon: <InventoryIcon fontSize="small" /> },
  { actionType: 'giveInventoryItems', label: 'Give Inventory Items', icon: <CardGiftcardIcon fontSize="small" /> },
  { actionType: 'attackAction', label: 'Attack Action', icon: <GavelIcon fontSize="small" /> },
  { actionType: 'setAttitudeAction', label: 'Set Attitude', icon: <EmojiPeopleIcon fontSize="small" /> },
  { actionType: 'chapterTransition', label: 'Chapter Transition', icon: <NavigationIcon fontSize="small" /> },
  { actionType: 'exchangeRoutine', label: 'Exchange Routine', icon: <SwapHorizIcon fontSize="small" /> },
  { actionType: 'givePlayerXPAction', label: 'Give XP', icon: <StarIcon fontSize="small" /> },
  { actionType: 'pickpocketAction', label: 'Pickpocket', icon: <GavelIcon fontSize="small" /> },
  { actionType: 'startOtherRoutineAction', label: 'Start Other Routine', icon: <SwapHorizIcon fontSize="small" /> },
  { actionType: 'teachAction', label: 'Teach', icon: <SchoolIcon fontSize="small" /> },
  { actionType: 'giveTradeInventoryAction', label: 'Give Trade Inventory', icon: <Inventory2Icon fontSize="small" /> },
  { actionType: 'removeInventoryItemsAction', label: 'Remove Inventory Items', icon: <RemoveShoppingCartIcon fontSize="small" /> },
  { actionType: 'insertNpcAction', label: 'Insert NPC', icon: <PersonAddIcon fontSize="small" /> },
  { actionType: 'conditionalAction', label: 'If / Else Block', icon: <CallSplitIcon fontSize="small" /> },
  { actionType: 'customAction', label: 'Custom Action', icon: <CodeIcon fontSize="small" /> },
];

const DialogActionsSection: React.FC<DialogActionsSectionProps> = ({
  dialogName,
  currentFunction,
  npcName,
  updateActionAtPath,
  deleteActionAtPath,
  deleteActionAndFocusPrevAtPath,
  addDialogLineAfterPath,
  addActionAfterPath,
  addActionToBranchEnd,
  moveAction,
  focusActionAtPath,
  registerActionRef,
  getVisibleActionPaths,
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
        </Box>
        <Tooltip title="Add action">
          <IconButton
            size="small"
            onClick={(event) => setAddMenuAnchor(event.currentTarget)}
            aria-label="Add action"
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={addMenuAnchor}
          open={Boolean(addMenuAnchor)}
          onClose={() => setAddMenuAnchor(null)}
          MenuListProps={{ dense: true, sx: { py: 1 } }}
          slotProps={{
            paper: {
              sx: {
                mt: 1,
                boxShadow: 2,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                minWidth: 200
              }
            }
          }}
        >
          {ADD_ACTION_ITEMS.map((item) => (
            <MenuItem
              key={item.actionType}
              onClick={() => {
                onAddActionToEnd(item.actionType);
                setAddMenuAnchor(null);
              }}
              sx={{ gap: 1.5 }}
            >
              <Box sx={{ display: 'flex', color: 'text.secondary' }}>
                {item.icon}
              </Box>
              {item.label}
            </MenuItem>
          ))}
        </Menu>
      </Box>

      {(currentFunction.actions || []).length === 0 ? (
        <Box sx={{
          p: 3,
          border: '2px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          textAlign: 'center',
          bgcolor: 'action.hover'
        }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            No actions yet
          </Typography>
          <Button
            startIcon={<AddIcon />}
            size="small"
            variant="outlined"
            onClick={(e) => setAddMenuAnchor(e.currentTarget)}
          >
            Add Action
          </Button>
        </Box>
      ) : (
        <ActionsList
          actions={currentFunction.actions || []}
          npcName={npcName}
          updateActionAtPath={updateActionAtPath}
          deleteActionAtPath={deleteActionAtPath}
          focusActionAtPath={focusActionAtPath}
          addDialogLineAfterPath={addDialogLineAfterPath}
          deleteActionAndFocusPrevAtPath={deleteActionAndFocusPrevAtPath}
          addActionAfterPath={addActionAfterPath}
          addActionToBranchEnd={addActionToBranchEnd}
          moveAction={moveAction}
          registerActionRef={registerActionRef}
          getVisibleActionPaths={getVisibleActionPaths}
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
