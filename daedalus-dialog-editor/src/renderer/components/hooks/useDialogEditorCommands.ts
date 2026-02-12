import { useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { generateUniqueChoiceFunctionName, createEmptyFunction } from '../dialogUtils';
import { createAction } from '../actionFactory';
import type { ActionTypeId } from '../actionTypes';
import type { DialogUpdater, FunctionUpdater } from '../dialogTypes';
import type {
  Dialog,
  DialogFunction,
  SemanticModel,
  ValidationResult
} from '../../types/global';
import type {
  DialogEditorSnackbarState,
  DialogEditorValidationDialogState
} from './useDialogEditorUIState';

interface UseDialogEditorCommandsParams {
  dialogName: string;
  filePath: string | null;
  currentFunctionName: string | null;
  currentFunction: DialogFunction | null;
  semanticModel?: SemanticModel;
  saveFile: (filePath: string, options?: { forceOnErrors?: boolean }) => Promise<{
    success: boolean;
    validationResult?: ValidationResult;
  }>;
  updateFunction: (filePath: string, functionName: string, func: DialogFunction) => void;
  focusAction: (index: number, scrollIntoView?: boolean) => void;
  setIsSaving: (value: boolean) => void;
  setIsResetting: (value: boolean) => void;
  setSnackbar: (value: DialogEditorSnackbarState) => void;
  setValidationDialog: (value: DialogEditorValidationDialogState) => void;
}

export function useDialogEditorCommands({
  dialogName,
  filePath,
  currentFunctionName,
  currentFunction,
  semanticModel,
  saveFile,
  updateFunction,
  focusAction,
  setIsSaving,
  setIsResetting,
  setSnackbar,
  setValidationDialog
}: UseDialogEditorCommandsParams) {
  const openFile = useEditorStore((state) => state.openFile);
  const renameFunction = useEditorStore((state) => state.renameFunction);
  const updateDialogWithUpdater = useEditorStore((state) => state.updateDialogWithUpdater);
  const updateFunctionWithUpdater = useEditorStore((state) => state.updateFunctionWithUpdater);
  const updateDialogConditionFunction = useEditorStore((state) => state.updateDialogConditionFunction);

  const setFunction = useCallback((updatedFunctionOrUpdater: FunctionUpdater) => {
    if (!currentFunctionName || !filePath) {
      return;
    }

    if (typeof updatedFunctionOrUpdater === 'function') {
      updateFunctionWithUpdater(filePath, currentFunctionName, updatedFunctionOrUpdater);
      return;
    }

    updateFunction(filePath, currentFunctionName, updatedFunctionOrUpdater);
  }, [currentFunctionName, filePath, updateFunction, updateFunctionWithUpdater]);

  const handleRenameFunction = useCallback((oldName: string, newName: string) => {
    if (!filePath) {
      return;
    }

    renameFunction(filePath, oldName, newName);
  }, [filePath, renameFunction]);

  const addActionToEnd = useCallback((actionType: ActionTypeId) => {
    if (!currentFunction || !filePath) {
      return;
    }

    let newAction = createAction(actionType, {
      dialogName,
      currentAction: undefined
    });

    if (actionType === 'choice') {
      const modelForUniqueness = semanticModel;

      if (!modelForUniqueness) {
        return;
      }

      const newFunctionName = generateUniqueChoiceFunctionName(dialogName, modelForUniqueness);
      const newFunction = createEmptyFunction(newFunctionName);
      updateFunction(filePath, newFunctionName, newFunction);
      newAction = {
        ...newAction,
        targetFunction: newFunctionName
      };
    }

    setFunction((previousFunction) => {
      const newActions = [...(previousFunction.actions || []), newAction];
      setTimeout(() => focusAction(newActions.length - 1, true), 0);
      return {
        ...previousFunction,
        actions: newActions
      };
    });
  }, [currentFunction, filePath, dialogName, semanticModel, updateFunction, setFunction, focusAction]);

  const handleDialogPropertyChange = useCallback((updater: DialogUpdater) => {
    if (!filePath) {
      return;
    }

    updateDialogWithUpdater(filePath, dialogName, (existingDialog) => {
      const updatedDialog = updater(existingDialog);
      const normalizedDialog: Dialog = {
        ...updatedDialog,
        properties: {
          ...updatedDialog.properties,
          information: typeof updatedDialog.properties?.information === 'object'
            ? updatedDialog.properties.information.name
            : updatedDialog.properties?.information,
          condition: typeof updatedDialog.properties?.condition === 'object'
            ? updatedDialog.properties.condition.name
            : updatedDialog.properties?.condition
        }
      };

      return normalizedDialog;
    });
  }, [dialogName, filePath, updateDialogWithUpdater]);

  const handleConditionFunctionUpdate = useCallback((funcOrUpdater: FunctionUpdater) => {
    if (!filePath) {
      return;
    }

    if (typeof funcOrUpdater === 'function') {
      updateDialogConditionFunction(filePath, dialogName, funcOrUpdater);
      return;
    }

    updateFunction(filePath, funcOrUpdater.name, funcOrUpdater);
  }, [dialogName, filePath, updateDialogConditionFunction, updateFunction]);

  const handleSave = useCallback(async (forceOnErrors = false) => {
    if (!filePath) {
      setSnackbar({
        open: true,
        message: 'Cannot save in project mode',
        severity: 'warning'
      });
      return;
    }

    setIsSaving(true);
    try {
      const result = await saveFile(filePath, { forceOnErrors });

      if (!result.success && result.validationResult) {
        setValidationDialog({
          open: true,
          validationResult: result.validationResult
        });
      } else {
        setSnackbar({
          open: true,
          message: 'File saved successfully!',
          severity: 'success'
        });
      }
    } catch (error) {
      console.error('Failed to save file:', error);
      setSnackbar({
        open: true,
        message: `Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error'
      });
    } finally {
      setIsSaving(false);
    }
  }, [filePath, saveFile, setIsSaving, setSnackbar, setValidationDialog]);

  const handleSaveAnyway = useCallback(async () => {
    setValidationDialog({ open: false, validationResult: null });
    await handleSave(true);
  }, [handleSave, setValidationDialog]);

  const handleCancelValidation = useCallback(() => {
    setValidationDialog({ open: false, validationResult: null });
  }, [setValidationDialog]);

  const handleReset = useCallback(async () => {
    if (!filePath) {
      setSnackbar({
        open: true,
        message: 'Cannot reset in project mode',
        severity: 'warning'
      });
      return;
    }

    setIsResetting(true);
    try {
      await openFile(filePath);
      setSnackbar({
        open: true,
        message: 'File reset successfully!',
        severity: 'info'
      });
    } catch (error) {
      console.error('Failed to reset file:', error);
      setSnackbar({
        open: true,
        message: `Failed to reset file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error'
      });
    } finally {
      setIsResetting(false);
    }
  }, [filePath, openFile, setIsResetting, setSnackbar]);

  return {
    setFunction,
    handleRenameFunction,
    addActionToEnd,
    handleDialogPropertyChange,
    handleConditionFunctionUpdate,
    handleSave,
    handleSaveAnyway,
    handleCancelValidation,
    handleReset
  };
}
