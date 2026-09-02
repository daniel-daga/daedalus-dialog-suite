import { useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import * as historyActions from '../../store/historyActions';
import type { DialogUpdater, FunctionUpdater } from '../dialogTypes';
import type { ValidationResult } from '../../types/global';
import { flushAllPendingEdits } from '../../utils/pendingEditFlushRegistry';
import type {
  DialogEditorSnackbarState,
  DialogEditorValidationDialogState
} from './useDialogEditorUIState';

interface UseDialogEditorCommandsParams {
  dialogName: string;
  filePath: string | null;
  currentFunctionName: string | null;
  saveFile: (filePath: string, options?: { forceOnErrors?: boolean }) => Promise<{
    success: boolean;
    validationResult?: ValidationResult;
  }>;
  setIsSaving: (value: boolean) => void;
  setIsResetting: (value: boolean) => void;
  setSnackbar: (value: DialogEditorSnackbarState) => void;
  setValidationDialog: (value: DialogEditorValidationDialogState) => void;
}

export function useDialogEditorCommands({
  dialogName,
  filePath,
  currentFunctionName,
  saveFile,
  setIsSaving,
  setIsResetting,
  setSnackbar,
  setValidationDialog
}: UseDialogEditorCommandsParams) {
  const updateFunction = historyActions.updateFunction;
  const openFile = useEditorStore((state) => state.openFile);
  const renameFunction = historyActions.renameFunction;
  const updateDialogWithNormalizedProperties = historyActions.updateDialogWithNormalizedProperties;
  const updateFunctionWithUpdater = historyActions.updateFunctionWithUpdater;
  const updateDialogConditionFunction = historyActions.updateDialogConditionFunction;
  const replaceDialogConditionFunction = historyActions.replaceDialogConditionFunction;

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

  const handleDialogPropertyChange = useCallback((updater: DialogUpdater) => {
    if (!filePath) {
      return;
    }

    updateDialogWithNormalizedProperties(filePath, dialogName, updater);
  }, [dialogName, filePath, updateDialogWithNormalizedProperties]);

  const handleConditionFunctionUpdate = useCallback((funcOrUpdater: FunctionUpdater) => {
    if (!filePath) {
      return;
    }

    if (typeof funcOrUpdater === 'function') {
      updateDialogConditionFunction(filePath, dialogName, funcOrUpdater);
      return;
    }

    replaceDialogConditionFunction(filePath, dialogName, funcOrUpdater);
  }, [dialogName, filePath, replaceDialogConditionFunction, updateDialogConditionFunction]);

  const handleSave = useCallback(async (forceOnErrors = false) => {
    if (!filePath) {
      setSnackbar({
        open: true,
        message: 'Cannot save in project mode',
        severity: 'warning'
      });
      return;
    }

    // Drain any debounced condition/action edit (N4) so the pending keystroke is
    // in the model before we serialize it.
    flushAllPendingEdits();

    setIsSaving(true);
    try {
      const result = await saveFile(filePath, { forceOnErrors });

      if (!result.success && result.validationResult) {
        setValidationDialog({
          open: true,
          validationResult: result.validationResult
        });
      } else if (result.validationResult && result.validationResult.warnings.length > 0) {
        // Warnings never block a save, so this is the only chance to surface
        // them (e.g. duplicate voice IDs — silently skipped lines in-game).
        setValidationDialog({
          open: true,
          validationResult: result.validationResult,
          mode: 'saved-with-warnings'
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
    handleDialogPropertyChange,
    handleConditionFunctionUpdate,
    handleSave,
    handleSaveAnyway,
    handleCancelValidation,
    handleReset
  };
}
