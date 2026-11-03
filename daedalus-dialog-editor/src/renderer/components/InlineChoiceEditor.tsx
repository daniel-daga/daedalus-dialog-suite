import React, { useCallback, useEffect, useMemo } from 'react';
import { Box, Divider, Typography } from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import ActionsList from './ActionsList';
import { useActionManagement } from './hooks/useActionManagement';
import { useResolvedFunction } from './hooks/useResolvedFunction';
import { useFocusNavigation } from './hooks/useFocusNavigation';
import { useStableHandlers } from './hooks/useStableHandlers';
import { flattenVisibleActionPaths } from './nestedActionUtils';
import { ActionLevelPatchContext } from './ActionLevelPatchContext';
import type { FunctionUpdater } from './dialogTypes';
import type { SemanticModel } from '../types/global';

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
  //
  // §3d: the merged fallback is only ever read for its `dialogs` (item seeding)
  // and `functions` (target/sibling lookup, unique-name generation) categories,
  // so subscribe to those two rather than the whole merged model — a no-op or
  // unrelated-category merge then no longer re-renders this sub-editor.
  const fileModel = useEditorStore((s) => (filePath ? s.openFiles.get(filePath)?.semanticModel : undefined));
  const mergedDialogs = useProjectStore((s) => s.mergedSemanticModel.dialogs);
  const mergedFunctions = useProjectStore((s) => s.mergedSemanticModel.functions);
  const semanticModel = useMemo<SemanticModel>(
    () => fileModel ?? { dialogs: mergedDialogs, functions: mergedFunctions, hasErrors: false, errors: [] },
    [fileModel, mergedDialogs, mergedFunctions]
  );

  // The target may be declared in another open file, and its model is the only
  // copy `updateFunction` will write — it drops a name its file does not hold.
  const ownerFilePath = useEditorStore((s) => {
    if (!targetFunctionName) return null;
    if (filePath && s.openFiles.get(filePath)?.semanticModel?.functions?.[targetFunctionName]) return filePath;
    for (const [candidatePath, file] of s.openFiles) {
      if (file.semanticModel?.functions?.[targetFunctionName]) return candidatePath;
    }
    return null;
  });
  const targetFilePath = ownerFilePath ?? filePath;

  const targetFunction = useResolvedFunction(targetFunctionName, targetFilePath);
  const { registerActionRef, focusAction } = useFocusNavigation();

  // No open file declares the target, so there is nowhere to write: both store
  // writes drop a name the target file's model does not hold (#518). The list
  // still renders (the merged model knows the function) but read-only.
  const isReadOnly = ownerFilePath === null;

  const setFunction = useCallback((updatedFuncOrUpdater: FunctionUpdater) => {
    if (!ownerFilePath || !targetFunctionName) return;
    if (typeof updatedFuncOrUpdater === 'function') {
      updateFunctionWithUpdater(ownerFilePath, targetFunctionName, updatedFuncOrUpdater);
      return;
    }
    updateFunction(ownerFilePath, targetFunctionName, updatedFuncOrUpdater);
  }, [targetFunctionName, ownerFilePath, updateFunction, updateFunctionWithUpdater]);

  const {
    updateAction,
    deleteAction,
    deleteActionAndFocusPrev,
    addDialogLineAfter,
    addActionAfter,
    addActionToBranchEnd,
    moveAction,
    patchActionsAtLevel,
  } = useActionManagement({
    setFunction,
    focusAction,
    semanticModel,
    onUpdateSemanticModel: (funcName, func) => {
      if (ownerFilePath) updateFunction(ownerFilePath, funcName, func);
    },
    contextName: dialogName,
    currentFunctionName: targetFunctionName,
  });

  const handleRenameFunction = useCallback((oldName: string, newName: string) => {
    if (!ownerFilePath) return;
    renameFunction(ownerFilePath, oldName, newName);
  }, [ownerFilePath, renameFunction]);

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
    patchActionsAtLevel,
    registerActionRef,
    getVisibleActionPaths: () => flattenVisibleActionPaths(targetFunction?.actions || []),
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

  // The choice's own function: its quest step cards patch it, not the dialog's (#322).
  const actionsList = (
    <ActionLevelPatchContext.Provider value={handlers.patchActionsAtLevel}>
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
        filePath={targetFilePath}
      />
    </ActionLevelPatchContext.Provider>
  );

  return (
    <Box sx={{ pl: 2, pt: 1 }}>
      <Divider sx={{ mb: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>{targetFunctionName}</Typography>
      </Divider>
      {isReadOnly ? (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Read-only: &quot;{targetFunctionName}&quot; is declared in a file that is not open.
            Open that file to edit its actions.
          </Typography>
          {/* `fieldset` is what actually disables every control the cards render. */}
          <Box component="fieldset" disabled sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            {actionsList}
          </Box>
        </>
      ) : actionsList}
    </Box>
  );
};

export default InlineChoiceEditor;
