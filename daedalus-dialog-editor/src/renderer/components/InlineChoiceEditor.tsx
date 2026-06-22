import React, { useCallback, useEffect } from 'react';
import { Box, Divider, Typography } from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import ActionsList from './ActionsList';
import { useActionManagement } from './hooks/useActionManagement';
import { useFocusNavigation } from './hooks/useFocusNavigation';
import { flattenActionPaths } from './nestedActionUtils';
import type { SemanticModel } from '../types/global';
import type { FunctionUpdater } from './dialogTypes';

interface InlineChoiceEditorProps {
  targetFunctionName: string;
  dialogName: string;
  filePath: string | null;
  semanticModel?: SemanticModel;
  npcName: string;
  /**
   * Each increment requests that focus move to the first line of the sub-dialog
   * (issue #118: Tab from the Choice Text field dives into the sub-editor). The
   * default 0 means "do not steal focus" — used when the editor is expanded by
   * mouse.
   */
  focusFirstActionNonce?: number;
}

const InlineChoiceEditor: React.FC<InlineChoiceEditorProps> = ({
  targetFunctionName,
  dialogName,
  filePath,
  semanticModel,
  npcName,
  focusFirstActionNonce = 0,
}) => {
  const updateFunction = useEditorStore((s) => s.updateFunction);
  const updateFunctionWithUpdater = useEditorStore((s) => s.updateFunctionWithUpdater);
  const renameFunction = useEditorStore((s) => s.renameFunction);

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
        updateActionAtPath={updateAction}
        deleteActionAtPath={deleteAction}
        focusActionAtPath={focusAction}
        addDialogLineAfterPath={addDialogLineAfter}
        deleteActionAndFocusPrevAtPath={deleteActionAndFocusPrev}
        addActionAfterPath={addActionAfter}
        addActionToBranchEnd={addActionToBranchEnd}
        moveAction={moveAction}
        registerActionRef={registerActionRef}
        getVisibleActionPaths={() => flattenActionPaths(actions)}
        semanticModel={semanticModel}
        onNavigateToFunction={undefined}
        onRenameFunction={handleRenameFunction}
        dialogContextName={dialogName}
        contextId={targetFunctionName}
        filePath={filePath}
      />
    </Box>
  );
};

export default InlineChoiceEditor;
