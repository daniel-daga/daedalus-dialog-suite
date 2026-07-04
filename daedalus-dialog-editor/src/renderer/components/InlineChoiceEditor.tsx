import React, { useCallback, useEffect } from 'react';
import { Box, Divider, Typography } from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import ActionsList from './ActionsList';
import { useActionManagement } from './hooks/useActionManagement';
import { useFocusNavigation } from './hooks/useFocusNavigation';
import { useStableHandlers } from './hooks/useStableHandlers';
import { flattenActionPaths } from './nestedActionUtils';
import type { FunctionUpdater } from './dialogTypes';

interface InlineChoiceEditorProps {
  targetFunctionName: string;
  dialogName: string;
  filePath: string | null;
  npcName: string;
  /**
   * Each increment requests that focus move to the first line of the sub-dialog
   * (issue #118: Tab from the Choice Text field dives into the sub-editor). The
   * default 0 means "do not steal focus" — used when the editor is expanded by
   * mouse.
   */
  focusFirstActionNonce?: number;
  /**
   * Invoked when Shift+Tab is pressed on the first sub-dialog line (which has no
   * previous line to move to). ChoiceRenderer wires this to re-focus the Choice
   * Text field — the reverse of the Tab-dive-in (issue #118).
   */
  onEscapeBackward?: () => void;
}

const InlineChoiceEditor: React.FC<InlineChoiceEditorProps> = ({
  targetFunctionName,
  dialogName,
  filePath,
  npcName,
  focusFirstActionNonce = 0,
  onEscapeBackward,
}) => {
  const updateFunction = useEditorStore((s) => s.updateFunction);
  const updateFunctionWithUpdater = useEditorStore((s) => s.updateFunctionWithUpdater);
  const renameFunction = useEditorStore((s) => s.renameFunction);

  // Self-resolve the model from the store rather than receiving it through the
  // ActionCard prop chain (fix-07 §2.8). Only mounted while a choice is expanded,
  // so subscribing here does not affect collapsed cards. File-first mirrors the
  // editor's resolution order, falling back to the merged project model.
  const fileModel = useEditorStore((s) => (filePath ? s.openFiles.get(filePath)?.semanticModel : undefined));
  const mergedModel = useProjectStore((s) => s.mergedSemanticModel);
  const semanticModel = fileModel ?? mergedModel;

  const targetFunction = semanticModel?.functions?.[targetFunctionName] || null;
  const { registerActionRef, focusAction } = useFocusNavigation();

  const setFunction = useCallback((updatedFuncOrUpdater: FunctionUpdater) => {
    if (!targetFunctionName || !filePath) return;
    if (typeof updatedFuncOrUpdater === 'function') {
      updateFunctionWithUpdater(filePath, targetFunctionName, updatedFuncOrUpdater);
      return;
    }
    updateFunction(filePath, targetFunctionName, updatedFuncOrUpdater);
  }, [targetFunctionName, filePath, updateFunction, updateFunctionWithUpdater]);

  const {
    updateAction,
    deleteAction,
    deleteActionAndFocusPrev,
    addDialogLineAfter,
    addActionAfter,
    addActionToBranchEnd,
    moveAction,
  } = useActionManagement({
    setFunction,
    focusAction,
    semanticModel,
    onUpdateSemanticModel: (funcName, func) => {
      if (filePath) updateFunction(filePath, funcName, func);
    },
    contextName: dialogName,
    currentFunctionName: targetFunctionName,
  });

  const handleRenameFunction = useCallback((oldName: string, newName: string) => {
    if (!filePath) return;
    renameFunction(filePath, oldName, newName);
  }, [filePath, renameFunction]);

  // Identity-stable wrappers for every function prop crossing the ActionCard memo
  // boundary in the sub-dialog list (fix-07 §2.8), mirroring DialogActionsSection.
  const handlers = useStableHandlers({
    updateActionAtPath: updateAction,
    deleteActionAtPath: deleteAction,
    focusActionAtPath: focusAction,
    addDialogLineAfterPath: addDialogLineAfter,
    deleteActionAndFocusPrevAtPath: deleteActionAndFocusPrev,
    addActionAfterPath: addActionAfter,
    addActionToBranchEnd,
    moveAction,
    registerActionRef,
    getVisibleActionPaths: () => flattenActionPaths(targetFunction?.actions || []),
    onNavigateToFunction: undefined,
    onRenameFunction: handleRenameFunction,
    onEscapeBackward,
  });

  const hasActions = (targetFunction?.actions?.length ?? 0) > 0;

  // Move focus to the first sub-dialog line whenever a fresh focus request
  // arrives (issue #118). focusAction queues the request, so it still lands if
  // the first card has not registered its ref yet.
  useEffect(() => {
    if (focusFirstActionNonce > 0 && hasActions) {
      focusAction([0]);
    }
    // Only re-run on a new request; focusAction is stable.
  }, [focusFirstActionNonce, hasActions, focusAction]);

  if (!targetFunction) {
    return (
      <Box sx={{ p: 1, pl: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Function &quot;{targetFunctionName}&quot; not found.
        </Typography>
      </Box>
    );
  }

  const actions = targetFunction.actions || [];

  if (actions.length === 0) {
    return (
      <Box sx={{ p: 1, pl: 2 }}>
        <Divider sx={{ mb: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>{targetFunctionName}</Typography>
        </Divider>
        <Typography variant="body2" color="text.secondary">
          No actions in this choice branch.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ pl: 2, pt: 1 }}>
      <Divider sx={{ mb: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>{targetFunctionName}</Typography>
      </Divider>
      <ActionsList
        actions={actions}
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
        onEscapeBackward={handlers.onEscapeBackward}
        dialogContextName={dialogName}
        contextId={targetFunctionName}
        droppableNamespace={targetFunctionName}
        filePath={filePath}
      />
    </Box>
  );
};

export default InlineChoiceEditor;
