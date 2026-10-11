/**
 * Auto-save routes its write through `fileStore.saveFile` (2026-07 3.1).
 *
 * The hook used to call `window.editorAPI.saveFile` itself, which forked the
 * save pipeline in two ways this file pins:
 *   - an `EXTERNAL_MODIFICATION:` rejection became a generic `saveError` chip
 *     instead of `externalConflict`, so the conflict dialog was never raised
 *     from an auto-save tick and the file was re-selected every tick;
 *   - a successful write wrote `hasErrors: false, errors: []`, clobbering the
 *     parse-state mirror the store's own success path deliberately leaves alone
 *     (`docs/architecture/save-pipeline.md`).
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useAutoSave } from '../src/renderer/hooks/useAutoSave';
import { renderHook, act } from '@testing-library/react';

const mockSaveFile = jest.spyOn(window.editorAPI, 'saveFile');

function openDirtyFile(filePath: string, extra: Record<string, unknown> = {}) {
  useEditorStore.setState({
    openFiles: new Map([[filePath, {
      filePath,
      semanticModel: {
        dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
        functions: {},
      },
      isDirty: true,
      lastSaved: new Date(),
      ...extra,
    }]] as any),
    activeFile: filePath,
    autoSaveEnabled: true,
    autoSaveInterval: 2000,
  });
}

describe('useAutoSave.conflictRouting', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useEditorStore.setState({ openFiles: new Map(), activeFile: null });
    mockSaveFile.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a rejected autosave sets externalConflict instead of a generic saveError', async () => {
    const filePath = 'conflicted.d';
    openDirtyFile(filePath);

    mockSaveFile.mockRejectedValueOnce(
      new Error('EXTERNAL_MODIFICATION: file changed on disk')
    );

    renderHook(() => useAutoSave());

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.externalConflict).toBeDefined();
    expect(fileState?.saveError).toBeUndefined();
    expect(fileState?.isDirty).toBe(true);

    // Candidacy excludes conflicted files, so the next tick must not retry.
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockSaveFile).toHaveBeenCalledTimes(1);
  });

  test('a successful autosave leaves the parse-state mirror alone', async () => {
    const filePath = 'parse-errors.d';
    openDirtyFile(filePath, {
      hasErrors: true,
      errors: [{ message: 'unexpected token', line: 3 }],
    });

    mockSaveFile.mockResolvedValueOnce({ success: true } as any);

    renderHook(() => useAutoSave());

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.isDirty).toBe(false);
    expect(fileState?.hasErrors).toBe(true);
    expect(fileState?.errors).toHaveLength(1);
  });
});
