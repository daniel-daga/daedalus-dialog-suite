/**
 * hasErrors lifecycle (E3 / N6).
 *
 * `semanticModel.hasErrors` is the single source of truth for "this is a partial
 * parse"; no visual mutation may clear it, and auto-save must keep excluding a
 * parse-errored file even after edits. Validation failures no longer masquerade
 * as parse errors (they set only autoSaveError).
 *
 * TDD: these are red before the lifecycle rework.
 */

import { describe, test, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useAutoSave } from '../src/renderer/hooks/useAutoSave';
import { renderHook, act } from '@testing-library/react';

const mockSaveFile = jest.spyOn(window.editorAPI, 'saveFile');

const baseState = {
  activeFile: null as string | null,
  pendingValidation: null,
  project: null,
  codeSettings: {
    indentChar: '\t' as const,
    includeComments: true,
    sectionHeaders: true,
    uppercaseKeywords: true,
  },
  autoSaveEnabled: true,
  autoSaveInterval: 2000,
};

describe('hasErrors lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useEditorStore.setState({ ...baseState, openFiles: new Map() });
    mockSaveFile.mockReset();
    mockSaveFile.mockResolvedValue({
      success: true,
      validationResult: { isValid: true, errors: [], warnings: [] },
    } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a parse-errored file is not auto-saved even after a visual mutation clears the FileState mirror', async () => {
    const filePath = 'partial.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: {
          dialogs: { D1: { properties: { npc: 'NPC1' } } },
          functions: {},
          hasErrors: true,
          errors: [{ type: 'syntax_error', message: 'unreadable' }],
        },
        isDirty: false,
        lastSaved: new Date(),
        hasErrors: true,
        errors: [{ type: 'syntax_error', message: 'unreadable' } as any],
      }]]),
      activeFile: filePath,
    });

    renderHook(() => useAutoSave());

    // A visual mutation marks the file dirty. Under the old rule this also
    // cleared fileState.hasErrors, opening the gate. The model stays partial.
    act(() => {
      useEditorStore.getState().updateDialog(filePath, 'D1', { properties: { npc: 'NPC2' } });
    });

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    expect(mockSaveFile).not.toHaveBeenCalled();
    // The model is still authoritative-partial.
    expect(useEditorStore.getState().getFileState(filePath)?.semanticModel.hasErrors).toBe(true);
  });

  test('autoSaveError blocks auto-save and a subsequent mutation clears it', async () => {
    const filePath = 'blocked.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: {
          dialogs: { D1: { properties: { npc: 'NPC1' } } },
          functions: {},
          hasErrors: false,
          errors: [],
        },
        isDirty: true,
        lastSaved: new Date(),
        autoSaveError: { isValid: false, errors: [{ type: 'syntax_error', message: 'x' }], warnings: [] } as any,
      }]]),
      activeFile: filePath,
    });

    renderHook(() => useAutoSave());

    // Blocked while autoSaveError is present.
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });
    expect(mockSaveFile).not.toHaveBeenCalled();

    // A mutation clears autoSaveError → the file becomes an auto-save candidate.
    act(() => {
      useEditorStore.getState().updateDialog(filePath, 'D1', { properties: { npc: 'NPC2' } });
    });
    expect(useEditorStore.getState().getFileState(filePath)?.autoSaveError).toBeUndefined();

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });
    expect(mockSaveFile).toHaveBeenCalledTimes(1);
  });

  test('a validation-failed auto-save records autoSaveError but does not overwrite errors/hasErrors', async () => {
    const filePath = 'valfail.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: {
          dialogs: { D1: { properties: { npc: 'NPC1' } } },
          functions: {},
          hasErrors: false,
          errors: [],
        },
        isDirty: true,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    const validationResult = {
      isValid: false,
      errors: [{ type: 'syntax_error', message: 'generated code broke', position: { row: 1, column: 1 } }],
      warnings: [],
    };
    mockSaveFile.mockReset();
    mockSaveFile.mockResolvedValue({ success: false, validationResult } as any);

    renderHook(() => useAutoSave());

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.isDirty).toBe(true);
    expect(fileState?.autoSaveError).toEqual(validationResult);
    // N6: parse-state mirror is untouched by a validation failure.
    expect(fileState?.hasErrors).toBeFalsy();
    expect(fileState?.errors ?? []).toHaveLength(0);
  });
});
