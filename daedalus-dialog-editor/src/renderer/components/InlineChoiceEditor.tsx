import React, { useCallback } from 'react';
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
}

const InlineChoiceEditor: React.FC<InlineChoiceEditorProps> = ({
  targetFunctionName,
  dialogName,
  filePath,
  semanticModel,
  npcName,
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
