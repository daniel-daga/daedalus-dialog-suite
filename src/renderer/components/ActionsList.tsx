import React from 'react';
import { Stack } from '@mui/material';
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

/**
 * Optimized list component that only re-renders when actions array changes
 * This prevents unnecessary re-renders of all ActionCards when parent state changes
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
  return (
    <Stack spacing={2}>
      {actions.map((action: any, idx: number) => (
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
    </Stack>
  );
}, (prevProps, nextProps) => {
  // Only re-render if actions array length changes or actions content changes
  // This is a shallow comparison - ActionCard's memo will handle deep comparison
  if (prevProps.actions.length !== nextProps.actions.length) return false;
  if (prevProps.npcName !== nextProps.npcName) return false;
  if (prevProps.dialogContextName !== nextProps.dialogContextName) return false;

  // Check if any action actually changed using IDs
  for (let i = 0; i < prevProps.actions.length; i++) {
    if (prevProps.actions[i].id !== nextProps.actions[i].id) {
      return false; // Actions order/identity changed
    }
  }

  return true; // No changes detected
});

ActionsList.displayName = 'ActionsList';

export default ActionsList;
