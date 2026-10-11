/**
 * Voice-ID (and other) validation WARNINGS on a SUCCESSFUL save must reach the
 * user. Warnings never block a save (isValid stays true), so before this fix
 * the success path showed only "File saved successfully!" and dropped the
 * warnings — the duplicate-voice-ID feature was invisible exactly when it
 * fired. A successful save with warnings now opens the validation dialog in
 * 'saved-with-warnings' mode (informational: single Close button, no
 * Save Anyway).
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import ValidationErrorDialog from '../src/renderer/components/ValidationErrorDialog';
import { useDialogEditorCommands } from '../src/renderer/components/hooks/useDialogEditorCommands';
import type { ValidationResult } from '../src/renderer/types/global';

const warningResult: ValidationResult = {
  isValid: true,
  errors: [],
  warnings: [
    {
      type: 'duplicate_voice_id',
      message: "Voice ID 'DIA_X_15_00' is already used in DIA_Other.d (DIA_Other_Info)",
      functionName: 'DIA_X_Info',
    } as any,
  ],
};

describe('handleSave with a successful save that has warnings', () => {
  const makeParams = (saveResult: { success: boolean; validationResult?: ValidationResult }) => ({
    dialogName: 'DIA_X',
    filePath: 'C:/mod/DIA_X.d',
    currentFunctionName: null,
    currentFunction: null,
    semanticModel: undefined,
    saveFile: jest.fn<any>().mockResolvedValue(saveResult),
    focusAction: jest.fn(),
    setIsSaving: jest.fn(),
    setIsResetting: jest.fn(),
    setSnackbar: jest.fn(),
    setValidationDialog: jest.fn(),
  });

  test('opens the validation dialog in saved-with-warnings mode instead of the plain success snackbar', async () => {
    const params = makeParams({ success: true, validationResult: warningResult });
    const { result } = renderHook(() => useDialogEditorCommands(params as any));

    await act(async () => {
      await result.current.handleSave();
    });

    expect(params.setValidationDialog).toHaveBeenCalledWith({
      open: true,
      validationResult: warningResult,
      mode: 'saved-with-warnings',
    });
    expect(params.setSnackbar).not.toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success' })
    );
  });

  test('keeps the plain success snackbar when there are no warnings', async () => {
    const params = makeParams({
      success: true,
      validationResult: { isValid: true, errors: [], warnings: [] },
    });
    const { result } = renderHook(() => useDialogEditorCommands(params as any));

    await act(async () => {
      await result.current.handleSave();
    });

    expect(params.setSnackbar).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success' })
    );
    expect(params.setValidationDialog).not.toHaveBeenCalledWith(
      expect.objectContaining({ open: true })
    );
  });
});

describe('ValidationErrorDialog saved-with-warnings mode', () => {
  const onClose = jest.fn();
  const onSaveAnyway = jest.fn();

  beforeEach(() => {
    onClose.mockReset();
    onSaveAnyway.mockReset();
  });

  test('renders as informational: warning title, warnings listed, Close only', () => {
    render(
      <ValidationErrorDialog
        open
        validationResult={warningResult}
        mode="saved-with-warnings"
        onClose={onClose}
        onSaveAnyway={onSaveAnyway}
        onCancel={onClose}
      />
    );

    expect(screen.getByText('Saved with Warnings')).toBeInTheDocument();
    expect(screen.getByText(/DIA_X_15_00.*already used/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save anyway/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  test('default mode still renders the blocking Validation Failed dialog', () => {
    render(
      <ValidationErrorDialog
        open
        validationResult={{
          isValid: false,
          errors: [{ type: 'missing_function', message: 'missing' } as any],
          warnings: [],
        }}
        onClose={onClose}
        onSaveAnyway={onSaveAnyway}
        onCancel={onClose}
      />
    );

    expect(screen.getByText('Validation Failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save anyway/i })).toBeInTheDocument();
  });
});
