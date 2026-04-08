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
  filePath?: string | null;
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
  contextId,
  filePath
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

      // One new item was added to an otherwise-fully-rendered large list — update
      // renderedCount synchronously (no delay) so we don't re-render unnecessarily.
      if (renderedCount >= actions.length - 1) {
        setRenderedCount(actions.length);
        return;
      }

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

  // For newly added items on large lists (renderedCount one behind), show the new
  // item immediately in the same render rather than waiting for the useEffect to
  // fire and increment renderedCount.
  const effectiveRendered = renderedCount >= actions.length - 1 ? actions.length : renderedCount;
  const visibleActions = actions.slice(0, Math.max(effectiveRendered, actions.length <= IMMEDIATE_RENDER_THRESHOLD ? actions.length : 0));

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId={droppableId}>
        {(provided) => (
          <Stack
            spacing={0}
            ref={provided.innerRef}
            {...provided.droppableProps}
            sx={{}}
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
                        filePath={filePath}
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
  if (prevProps.filePath !== nextProps.filePath) return false;
  if (prevProps.onRenameFunction !== nextProps.onRenameFunction) return false;

  if (prevProps.actions === nextProps.actions) return true; // Same reference
  if (prevProps.actions.length !== nextProps.actions.length) return false;
  if (prevProps.npcName !== nextProps.npcName) return false;
  if (prevProps.dialogContextName !== nextProps.dialogContextName) return false;
  if (prevProps.contextId !== nextProps.contextId) return false; // Check contextId
  if ((prevProps.pathPrefix || []).join('.') !== (nextProps.pathPrefix || []).join('.')) return false;

  // Check each action by reference - if any reference changed, re-render so
  // ActionCard can receive the updated props and apply its own memo comparison.
  for (let i = 0; i < prevProps.actions.length; i++) {
    if (prevProps.actions[i] !== nextProps.actions[i]) {
      return false;
    }
  }

  return true; // No changes detected
});

ActionsList.displayName = 'ActionsList';

export default ActionsList;
