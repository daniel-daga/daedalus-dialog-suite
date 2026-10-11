import { useState } from 'react';
import type { ValidationResult } from '../../types/global';

export interface DialogEditorSnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error' | 'info' | 'warning';
}

export interface DialogEditorValidationDialogState {
  open: boolean;
  validationResult: ValidationResult | null;
  /**
   * 'save-blocked' (default): validation errors stopped the save — offer
   * Save Anyway. 'saved-with-warnings': the save succeeded but produced
   * warnings (e.g. duplicate voice IDs) — informational, Close only.
   */
  mode?: 'save-blocked' | 'saved-with-warnings';
}

export function useDialogEditorUIState() {
  const [propertiesExpanded, setPropertiesExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [sourceViewOpen, setSourceViewOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<DialogEditorSnackbarState>({
    open: false,
    message: '',
    severity: 'info'
  });
  const [validationDialog, setValidationDialog] = useState<DialogEditorValidationDialogState>({
    open: false,
    validationResult: null
  });

  return {
    propertiesExpanded,
    setPropertiesExpanded,
    isSaving,
    setIsSaving,
    isResetting,
    setIsResetting,
    sourceViewOpen,
    setSourceViewOpen,
    snackbar,
    setSnackbar,
    validationDialog,
    setValidationDialog
  };
}
