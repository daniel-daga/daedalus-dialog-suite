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
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import ActionsList from './ActionsList';
import ActionTypeMenu from './common/ActionTypeMenu';
import { DragDispatchContext } from './DragDispatchContext';
import type { DragMoveHandler, DragDispatchContextValue } from './DragDispatchContext';
import { useStableHandlers } from './hooks/useStableHandlers';
import type { ActionTypeId } from './actionTypes';
import type { DialogAction, DialogFunction } from '../types/global';
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
  onNavigateToFunction,
  onRenameFunction,
  onAddActionToEnd,
  filePath
}) => {
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  // Identity-stable wrappers for every function prop that crosses the ActionCard
  // memo boundary (fix-07 §2.8). This is a plain (non-memoized) component, so it
  // re-renders whenever these handlers are recreated upstream and the wrappers'
  // shared ref is refreshed — the memoized cards keep their stable props but any
  // click routes to the latest implementation.
  const handlers = useStableHandlers({
    updateActionAtPath,
    deleteActionAtPath,
    focusActionAtPath,
    addDialogLineAfterPath,
    deleteActionAndFocusPrevAtPath,
    addActionAfterPath,
    addActionToBranchEnd,
    moveAction,
    registerActionRef,
    getVisibleActionPaths,
    onNavigateToFunction,
    onRenameFunction,
  });

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
              updateActionAtPath={handlers.updateActionAtPath}
              deleteActionAtPath={handlers.deleteActionAtPath}
              focusActionAtPath={handlers.focusActionAtPath}
              addDialogLineAfterPath={handlers.addDialogLineAfterPath}
              deleteActionAndFocusPrevAtPath={handlers.deleteActionAndFocusPrevAtPath}
              addActionAfterPath={handlers.addActionAfterPath}
              addActionToBranchEnd={handlers.addActionToBranchEnd}
              moveAction={handlers.moveAction}
              registerActionRef={handlers.registerActionRef}
              getVisibleActionPaths={handlers.getVisibleActionPaths}
              onNavigateToFunction={handlers.onNavigateToFunction}
              onRenameFunction={handlers.onRenameFunction}
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
