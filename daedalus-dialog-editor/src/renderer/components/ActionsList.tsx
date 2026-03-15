import React, { useState, useEffect, useCallback } from 'react';
import { Stack, Box } from '@mui/material';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import ActionCard from './ActionCard';
import type { ActionTypeId } from './actionTypes';
import type { DialogAction, SemanticModel } from '../types/global';
import type { ActionBranchKey, ActionPath } from './nestedActionUtils';
import { actionPathToKey } from './nestedActionUtils';

interface ActionsListProps {
  actions: DialogAction[];
  pathPrefix?: ActionPath;
  npcName: string;
  updateActionAtPath: (path: ActionPath, updatedAction: DialogAction) => void;
  deleteActionAtPath: (path: ActionPath) => void;
  focusActionAtPath: (path: ActionPath, scrollIntoView?: boolean) => void;
  addDialogLineAfterPath: (path: ActionPath, toggleSpeaker?: boolean) => void;
  deleteActionAndFocusPrevAtPath: (path: ActionPath) => void;
  addActionAfterPath: (path: ActionPath, actionType: ActionTypeId) => void;
  addActionToBranchEnd?: (path: ActionPath, branch: ActionBranchKey, actionType: ActionTypeId) => void;
  moveAction?: (pathPrefix: ActionPath, sourceIndex: number, destinationIndex: number) => void;
  registerActionRef: (path: ActionPath, element: HTMLInputElement | null) => void;
  getVisibleActionPaths: () => ActionPath[];
  semanticModel?: SemanticModel;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction?: (oldName: string, newName: string) => void;
  dialogContextName: string;
  contextId?: string; // Unique ID to reset progressive rendering (e.g. function name)
}

// Progressive rendering threshold - render all if less than this
const IMMEDIATE_RENDER_THRESHOLD = 20;
const INITIAL_BATCH_SIZE = 10;
const BATCH_DELAY_MS = 16; // ~1 frame at 60fps
const getActionIdentity = (action: DialogAction, fallbackIndex: number): string =>
  action.type === 'DialogLine' ? action.id : `${action.type}:${fallbackIndex}`;

/**
 * Optimized list component that only re-renders when actions array changes
 * Uses progressive rendering for large lists to keep initial render fast
 */
const ActionsList = React.memo<ActionsListProps>(({
  actions,
  pathPrefix = [],
  npcName,
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
  semanticModel,
  onNavigateToFunction,
  onRenameFunction,
  dialogContextName,
  contextId
}) => {
  // Progressive rendering for large lists
  const [renderedCount, setRenderedCount] = useState(() =>
    actions.length <= IMMEDIATE_RENDER_THRESHOLD ? actions.length : INITIAL_BATCH_SIZE
  );

  useEffect(() => {
    // Reset rendered count when context ID changes (e.g. switched function)
    // If contextId is not provided, we don't reset automatically on actions change
    // to avoid resetting during editing.
    if (contextId) {
      setRenderedCount(
        actions.length <= IMMEDIATE_RENDER_THRESHOLD ? actions.length : INITIAL_BATCH_SIZE
      );
    }
  }, [contextId]); // Only depend on contextId

  // If actions length changed and it's small, update renderedCount immediately
  // to ensure new items are rendered and can be focused.
  useEffect(() => {
    if (actions.length <= IMMEDIATE_RENDER_THRESHOLD && renderedCount < actions.length) {
      setRenderedCount(actions.length);
    }
  }, [actions.length, renderedCount]);

  useEffect(() => {
    // Progressively render remaining items
    // This effect ensures that if actions are added, or if initial render was partial,
    // we eventually show everything.
    if (renderedCount < actions.length) {
      // If we're below the threshold, we handle it in the effect above immediately
      if (actions.length <= IMMEDIATE_RENDER_THRESHOLD) return;

      const timer = setTimeout(() => {
        setRenderedCount(prev => Math.min(prev + 10, actions.length));
      }, BATCH_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [renderedCount, actions.length]);

  const droppableId = actionPathToKey(pathPrefix) || 'root';

  const handleDragEnd = useCallback((result: DropResult) => {
    if (!result.destination || !moveAction) return;
    if (result.source.index === result.destination.index) return;
    moveAction(pathPrefix, result.source.index, result.destination.index);
  }, [moveAction, pathPrefix]);

  const visibleActions = actions.slice(0, Math.max(renderedCount, actions.length <= IMMEDIATE_RENDER_THRESHOLD ? actions.length : 0));

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId={droppableId}>
        {(provided) => (
          <Stack
            spacing={2}
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            {visibleActions.map((action: DialogAction, idx: number) => {
              const draggableId = `${droppableId}-${getActionIdentity(action, idx)}`;
              return (
                <Draggable key={getActionIdentity(action, idx)} draggableId={draggableId} index={idx}>
                  {(draggableProvided, snapshot) => (
                    <Box
                      ref={draggableProvided.innerRef}
                      {...draggableProvided.draggableProps}
                      sx={{
                        opacity: snapshot.isDragging ? 0.8 : 1,
                        boxShadow: snapshot.isDragging ? 4 : 0,
                        borderRadius: snapshot.isDragging ? 1 : 0,
                        bgcolor: snapshot.isDragging ? 'background.paper' : 'transparent',
                      }}
                    >
                      <ActionCard
                        path={[...pathPrefix, idx]}
                        action={action}
                        index={idx}
                        totalActions={actions.length}
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
                        dialogContextName={dialogContextName}
                        dragHandleProps={draggableProvided.dragHandleProps}
                      />
                    </Box>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
            {renderedCount < actions.length && (
              <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary', fontStyle: 'italic' }}>
                Loading {actions.length - renderedCount} more actions...
              </Box>
            )}
          </Stack>
        )}
      </Droppable>
    </DragDropContext>
  );
}, (prevProps, nextProps) => {
  // Fast bailout checks
  // If semantic model changed, we must re-render because callbacks (like onRenameFunction)
  // likely depend on it and need to be updated to capture the latest model.
  if (prevProps.semanticModel !== nextProps.semanticModel) return false;
  if (prevProps.onRenameFunction !== nextProps.onRenameFunction) return false;

  if (prevProps.actions === nextProps.actions) return true; // Same reference
  if (prevProps.actions.length !== nextProps.actions.length) return false;
  if (prevProps.npcName !== nextProps.npcName) return false;
  if (prevProps.dialogContextName !== nextProps.dialogContextName) return false;
  if (prevProps.contextId !== nextProps.contextId) return false; // Check contextId
  if ((prevProps.pathPrefix || []).join('.') !== (nextProps.pathPrefix || []).join('.')) return false;

  // Quick check - if the arrays have the same actions in the same order
  // We rely on action IDs for identity, and ActionCard memo for deep comparison
  for (let i = 0; i < prevProps.actions.length; i++) {
    // Only check if the action reference changed
    // Don't do deep comparison here - let ActionCard handle that
    if (prevProps.actions[i] !== nextProps.actions[i]) {
      // Actions array was recreated but might have same content
      // Check IDs as a fast heuristic
      if (
        getActionIdentity(prevProps.actions[i], i) !==
        getActionIdentity(nextProps.actions[i], i)
      ) {
        return false; // Different action
      }
    }
  }

  return true; // No changes detected
});

ActionsList.displayName = 'ActionsList';

export default ActionsList;
