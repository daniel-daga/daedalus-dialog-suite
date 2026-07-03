import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
} from '@mui/icons-material';
import { DragDropContext, DropResult } from 'react-beautiful-dnd';
import ActionsList from './ActionsList';
import ActionTypeMenu from './common/ActionTypeMenu';
import { DragDispatchContext } from './DragDispatchContext';
import type { DragMoveHandler, DragDispatchContextValue } from './DragDispatchContext';
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
  filePath?: string | null;
}

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
  onAddActionToEnd,
  filePath
}) => {
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  // Single DragDropContext for the whole dialog pane (fix-05 §2.5). Every
  // descendant ActionsList — top-level list, ConditionalAction branches, and
  // InlineChoice sub-lists — registers its move handler here keyed by its
  // namespaced droppableId, so no nested contexts exist.
  const handlersRef = useRef<Map<string, DragMoveHandler>>(new Map());
  const dragDispatch = useMemo<DragDispatchContextValue>(() => ({
    register: (droppableId, handler) => {
      handlersRef.current.set(droppableId, handler);
      return () => {
        if (handlersRef.current.get(droppableId) === handler) {
          handlersRef.current.delete(droppableId);
        }
      };
    },
  }), []);

  const handleDragEnd = useCallback((result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;
    // Cross-list moves stay unsupported (as before the hoist).
    if (source.droppableId !== destination.droppableId) return;
    if (source.index === destination.index) return;
    handlersRef.current.get(source.droppableId)?.(source.index, destination.index);
  }, []);

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
        <ActionTypeMenu
          anchorEl={addMenuAnchor}
          onClose={() => setAddMenuAnchor(null)}
          onSelect={onAddActionToEnd}
        />
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
        <DragDispatchContext.Provider value={dragDispatch}>
          <DragDropContext onDragEnd={handleDragEnd}>
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
              filePath={filePath}
            />
          </DragDropContext>
        </DragDispatchContext.Provider>
      )}
    </Paper>
  );
};

export default DialogActionsSection;
