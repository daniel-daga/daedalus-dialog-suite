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
  isProjectMode: boolean;
  saveFile: (filePath: string, options?: { forceOnErrors?: boolean }) => Promise<{
    success: boolean;
    validationResult?: ValidationResult;
  }>;
  updateDialog: (filePath: string, dialogName: string, dialog: Dialog) => void;
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
  isProjectMode,
  saveFile,
  updateDialog,
  updateFunction,
  focusAction,
  setIsSaving,
  setIsResetting,
  setSnackbar,
  setValidationDialog
}: UseDialogEditorCommandsParams) {
  const getFileState = useEditorStore((state) => state.getFileState);
  const openFile = useEditorStore((state) => state.openFile);
  const updateModel = useEditorStore((state) => state.updateModel);

  const setFunction = useCallback((updatedFunctionOrUpdater: FunctionUpdater) => {
    if (!currentFunctionName || !filePath) {
      return;
    }

    if (typeof updatedFunctionOrUpdater === 'function') {
      const latestFileState = getFileState(filePath);
      const existingFunction = latestFileState?.semanticModel?.functions?.[currentFunctionName];

      if (!existingFunction) {
        return;
      }

      const updatedFunction = updatedFunctionOrUpdater(existingFunction);
      if (!updatedFunction) {
        return;
      }

      updateFunction(filePath, currentFunctionName, updatedFunction);
      return;
    }

    updateFunction(filePath, currentFunctionName, updatedFunctionOrUpdater);
  }, [currentFunctionName, filePath, getFileState, updateFunction]);

  const handleRenameFunction = useCallback((oldName: string, newName: string) => {
    if (!filePath) {
      return;
    }

    const latestFileState = getFileState(filePath);
    const latestModel = latestFileState?.semanticModel;

    if (!latestModel) {
      return;
    }

    const existingFunction = latestModel.functions[oldName];
    if (!existingFunction) {
      return;
    }

    const updatedFunctions = { ...latestModel.functions };
    delete updatedFunctions[oldName];
    updatedFunctions[newName] = { ...existingFunction, name: newName };

    updateModel(filePath, {
      ...latestModel,
      functions: updatedFunctions
    });
  }, [filePath, getFileState, updateModel]);

  const addActionToEnd = useCallback((actionType: ActionTypeId) => {
    if (!currentFunction || !filePath) {
      return;
    }

    let newAction = createAction(actionType, {
      dialogName,
      currentAction: undefined
    });

    if (actionType === 'choice') {
      const latestFileState = getFileState(filePath);
      const modelForUniqueness = isProjectMode
        ? semanticModel
        : (latestFileState?.semanticModel || semanticModel);

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
  }, [currentFunction, filePath, dialogName, getFileState, isProjectMode, semanticModel, updateFunction, setFunction, focusAction]);

  const handleDialogPropertyChange = useCallback((updater: DialogUpdater) => {
    if (!filePath) {
      return;
    }

    const latestFileState = getFileState(filePath);
    const existingDialog = latestFileState?.semanticModel?.dialogs?.[dialogName];

    if (!existingDialog) {
      return;
    }

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

    updateDialog(filePath, dialogName, normalizedDialog);
  }, [dialogName, filePath, getFileState, updateDialog]);

  const handleConditionFunctionUpdate = useCallback((funcOrUpdater: FunctionUpdater) => {
    if (!filePath) {
      return;
    }

    if (typeof funcOrUpdater === 'function') {
      const latestFileState = getFileState(filePath);
      const latestModel = latestFileState?.semanticModel;
      const latestDialog = latestModel?.dialogs?.[dialogName];

      const conditionFunctionName = typeof latestDialog?.properties?.condition === 'object'
        ? latestDialog.properties.condition.name
        : latestDialog?.properties?.condition;

      if (!conditionFunctionName) {
        return;
      }

      const existingFunction = latestModel?.functions?.[conditionFunctionName];
      if (!existingFunction) {
        return;
      }

      const updatedFunction = funcOrUpdater(existingFunction);
      if (!updatedFunction) {
        return;
      }

      updateFunction(filePath, conditionFunctionName, updatedFunction);
      return;
    }

    updateFunction(filePath, funcOrUpdater.name, funcOrUpdater);
  }, [dialogName, filePath, getFileState, updateFunction]);

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
