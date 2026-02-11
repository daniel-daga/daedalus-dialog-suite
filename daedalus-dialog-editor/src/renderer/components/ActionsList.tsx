import React, { useState, useEffect } from 'react';
import { Stack, Box } from '@mui/material';
import ActionCard from './ActionCard';
import type { ActionTypeId } from './actionTypes';
import type { DialogAction, SemanticModel } from '../types/global';

interface ActionsListProps {
  actions: DialogAction[];
  actionRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  npcName: string;
  updateAction: (index: number, updatedAction: DialogAction) => void;
  deleteAction: (index: number) => void;
  focusAction: (index: number, scrollIntoView?: boolean) => void;
  addDialogLineAfter: (index: number, toggleSpeaker?: boolean) => void;
  deleteActionAndFocusPrev: (index: number) => void;
  addActionAfter: (index: number, actionType: ActionTypeId) => void;
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
  actionRefs,
  npcName,
  updateAction,
  deleteAction,
  focusAction,
  addDialogLineAfter,
  deleteActionAndFocusPrev,
  addActionAfter,
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

  return (
    <Stack spacing={2}>
      {actions.slice(0, Math.max(renderedCount, actions.length <= IMMEDIATE_RENDER_THRESHOLD ? actions.length : 0)).map((action: DialogAction, idx: number) => (
        <ActionCard
          key={getActionIdentity(action, idx)}
          ref={(el) => (actionRefs.current[idx] = el)}
          action={action}
          index={idx}
          totalActions={actions.length}
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
          dialogContextName={dialogContextName}
        />
      ))}
      {renderedCount < actions.length && (
        <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary', fontStyle: 'italic' }}>
          Loading {actions.length - renderedCount} more actions...
        </Box>
      )}
    </Stack>
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
