import React, { useState, useEffect } from 'react';
import { Stack, Box } from '@mui/material';
import ActionCard from './ActionCard';

interface ActionsListProps {
  actions: any[];
  actionRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  npcName: string;
  updateAction: (index: number, updatedAction: any) => void;
  deleteAction: (index: number) => void;
  focusAction: (index: number, scrollIntoView?: boolean) => void;
  addDialogLineAfter: (index: number, toggleSpeaker?: boolean) => void;
  deleteActionAndFocusPrev: (index: number) => void;
  addActionAfter: (index: number, actionType: string) => void;
  semanticModel?: any;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction?: (oldName: string, newName: string) => void;
  dialogContextName: string;
}

// Progressive rendering threshold - render all if less than this
const IMMEDIATE_RENDER_THRESHOLD = 20;
const INITIAL_BATCH_SIZE = 10;
const BATCH_DELAY_MS = 16; // ~1 frame at 60fps

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
  dialogContextName
}) => {
  // Progressive rendering for large lists
  const [renderedCount, setRenderedCount] = useState(() =>
    actions.length <= IMMEDIATE_RENDER_THRESHOLD ? actions.length : INITIAL_BATCH_SIZE
  );

  useEffect(() => {
    // Reset rendered count when actions change
    setRenderedCount(
      actions.length <= IMMEDIATE_RENDER_THRESHOLD ? actions.length : INITIAL_BATCH_SIZE
    );
  }, [actions.length]);

  useEffect(() => {
    // Progressively render remaining items
    if (renderedCount < actions.length) {
      const timer = setTimeout(() => {
        setRenderedCount(prev => Math.min(prev + 10, actions.length));
      }, BATCH_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [renderedCount, actions.length]);

  return (
    <Stack spacing={2}>
      {actions.slice(0, renderedCount).map((action: any, idx: number) => (
        <ActionCard
          key={action.id || idx}
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

  // Quick check - if the arrays have the same actions in the same order
  // We rely on action IDs for identity, and ActionCard memo for deep comparison
  for (let i = 0; i < prevProps.actions.length; i++) {
    // Only check if the action reference changed
    // Don't do deep comparison here - let ActionCard handle that
    if (prevProps.actions[i] !== nextProps.actions[i]) {
      // Actions array was recreated but might have same content
      // Check IDs as a fast heuristic
      if (prevProps.actions[i]?.id !== nextProps.actions[i]?.id) {
        return false; // Different action
      }
    }
  }

  return true; // No changes detected
});

ActionsList.displayName = 'ActionsList';

export default ActionsList;
