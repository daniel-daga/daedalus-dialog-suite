import React, { useState, useEffect, useCallback, useContext, useMemo, useRef } from 'react';
import { Stack, Box } from '@mui/material';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import ActionCard from './ActionCard';
import type { ActionTypeId } from './actionTypes';
import type { DialogAction } from '../types/global';
import type { ActionBranchKey, ActionPath } from './nestedActionUtils';
import { actionPathToKey } from './nestedActionUtils';
import { DragDispatchContext } from './DragDispatchContext';

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
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction?: (oldName: string, newName: string) => void;
  dialogContextName: string;
  contextId?: string; // Unique ID to reset progressive rendering (e.g. function name)
  filePath?: string | null;
  /**
   * Namespace that keeps this list's droppableId unique across the single
   * hoisted DragDropContext (fix-05 §2.5). Defaults to dialogContextName. Choice
   * sub-lists pass their target function name because their moveAction targets a
   * different function — which is exactly why dispatch is a registry, not path
   * parsing.
   */
  droppableNamespace?: string;
}

// Progressive rendering threshold - render all if less than this
const IMMEDIATE_RENDER_THRESHOLD = 20;
const INITIAL_BATCH_SIZE = 10;
const BATCH_DELAY_MS = 16; // ~1 frame at 60fps
// Keep identities free of ':' — the dnd library builds internal lookups that
// can break on a colon inside a draggableId (finding U5). '__' is our safe delimiter.
const getActionIdentity = (action: DialogAction, fallbackIndex: number): string =>
  action.type === 'DialogLine' ? action.id : `${action.type}__${fallbackIndex}`;

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
  onNavigateToFunction,
  onRenameFunction,
  dialogContextName,
  contextId,
  filePath,
  droppableNamespace
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

  // Namespaced droppableId: unique across the single hoisted DragDropContext.
  // The local path disambiguates lists within one function (root vs. conditional
  // branches); the namespace disambiguates across functions (choice sub-lists).
  // Namespace + path form a globally unique droppableId. The delimiter must be
  // ':'-free: a colon anywhere in a draggableId (droppableId is its prefix)
  // can break the dnd library's drag start (finding U5).
  const effectiveNamespace = droppableNamespace ?? dialogContextName;
  const droppableId = `${effectiveNamespace}__${actionPathToKey(pathPrefix) || 'root'}`;

  // Stable per-item identities: disambiguate duplicate DialogLine ids
  // (real mod files repeat AI_Output ids) so React keys and rbd draggableIds
  // are always unique and stable for a given list content (finding U5).
  const identities = useMemo(() => {
    const counts = new Map<string, number>();
    return actions.map((action, idx) => {
      const base = getActionIdentity(action, idx);
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      return n === 1 ? base : `${base}@${n}`;
    });
  }, [actions]);

  // Register this list's move handler with the pane's single DragDropContext,
  // keyed by droppableId. A stable wrapper reads the latest moveAction/pathPrefix
  // from a ref so re-registration only happens when the droppableId changes.
  const dragDispatch = useContext(DragDispatchContext);
  const moveRef = useRef<(s: number, d: number) => void>(() => {});
  moveRef.current = (sourceIndex: number, destinationIndex: number) => {
    if (moveAction) moveAction(pathPrefix, sourceIndex, destinationIndex);
  };
  useEffect(() => {
    if (!dragDispatch) return;
    return dragDispatch.register(droppableId, (s, d) => moveRef.current(s, d));
  }, [dragDispatch, droppableId]);

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

  const droppable = (
    <Droppable droppableId={droppableId}>
      {(provided) => (
        <Stack
          spacing={0}
          ref={provided.innerRef}
          {...provided.droppableProps}
          sx={{}}
        >
          {visibleActions.map((action: DialogAction, idx: number) => {
            const identity = identities[idx];
            const draggableId = `${droppableId}-${identity}`;
            return (
              <Draggable key={identity} draggableId={draggableId} index={idx}>
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
                      onNavigateToFunction={onNavigateToFunction}
                      onRenameFunction={onRenameFunction}
                      dialogContextName={dialogContextName}
                      droppableNamespace={effectiveNamespace}
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
  );

  // Inside a pane provider: just the Droppable (one shared context dispatches
  // drops). Standalone (no provider): wrap in a local DragDropContext so the
  // list still drags on its own — used by isolated renders and unit tests.
  if (dragDispatch) {
    return droppable;
  }
  return <DragDropContext onDragEnd={handleDragEnd}>{droppable}</DragDropContext>;
}, (prevProps, nextProps) => {
  // Fast bailout checks
  if (prevProps.filePath !== nextProps.filePath) return false;
  if (prevProps.onRenameFunction !== nextProps.onRenameFunction) return false;

  if (prevProps.actions === nextProps.actions) return true; // Same reference
  if (prevProps.actions.length !== nextProps.actions.length) return false;
  if (prevProps.npcName !== nextProps.npcName) return false;
  if (prevProps.dialogContextName !== nextProps.dialogContextName) return false;
  if (prevProps.contextId !== nextProps.contextId) return false; // Check contextId
  if (prevProps.droppableNamespace !== nextProps.droppableNamespace) return false;
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
