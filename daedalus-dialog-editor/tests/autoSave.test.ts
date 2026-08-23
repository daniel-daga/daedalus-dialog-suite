/**
 * Tests for auto-save feature
 *
 * TDD: Writing tests first before implementing the feature
 */

import { describe, test, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useAutoSave } from '../src/renderer/hooks/useAutoSave';
import { registerPendingEditFlusher } from '../src/renderer/utils/pendingEditFlushRegistry';
import { renderHook, act } from '@testing-library/react';

// Spy on the window.editorAPI.saveFile that is set up in tests/setup.ts
const mockSaveFile = jest.spyOn(window.editorAPI, 'saveFile');

describe('Auto-save configuration', () => {
  beforeEach(() => {
    useEditorStore.setState({
      openFiles: new Map(),
      activeFile: null,
      selectedDialog: null,
      selectedAction: null,
      project: null,
      codeSettings: {
        indentChar: '\t',
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true,
      },
      autoSaveEnabled: true,
      autoSaveInterval: 2000,
    });
    mockSaveFile.mockClear();
  });

  test('should have auto-save enabled by default', () => {
    const state = useEditorStore.getState();
    expect(state.autoSaveEnabled).toBe(true);
  });

  test('should have default auto-save interval of 2000ms', () => {
    const state = useEditorStore.getState();
    expect(state.autoSaveInterval).toBe(2000);
  });

  test('should allow toggling auto-save on/off', () => {
    useEditorStore.getState().setAutoSaveEnabled(false);
    expect(useEditorStore.getState().autoSaveEnabled).toBe(false);

    useEditorStore.getState().setAutoSaveEnabled(true);
    expect(useEditorStore.getState().autoSaveEnabled).toBe(true);
  });

  test('should allow changing auto-save interval', () => {
    useEditorStore.getState().setAutoSaveInterval(5000);
    expect(useEditorStore.getState().autoSaveInterval).toBe(5000);
  });
});

describe('useAutoSave hook', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useEditorStore.setState({
      openFiles: new Map(),
      activeFile: null,
      selectedDialog: null,
      selectedAction: null,
      project: null,
      codeSettings: {
        indentChar: '\t',
        includeComments: true,
        sectionHeaders: true,
        uppercaseKeywords: true,
      },
      autoSaveEnabled: true,
      autoSaveInterval: 2000,
    });
    mockSaveFile.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should not trigger save when file is not dirty', async () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
      functions: {},
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    renderHook(() => useAutoSave());

    jest.advanceTimersByTime(3000);

    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  test('should trigger save when file becomes dirty', async () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
      functions: {},
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    renderHook(() => useAutoSave());

    // Make file dirty
    act(() => {
      useEditorStore.getState().updateDialog(filePath, 'TestDialog', {
        properties: { npc: 'UpdatedNPC' },
      });
    });

    // Advance time past the auto-save interval
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    expect(mockSaveFile).toHaveBeenCalledWith(
      filePath,
      expect.objectContaining({
        dialogs: expect.objectContaining({
          TestDialog: { properties: { npc: 'UpdatedNPC' } },
        }),
      }),
      expect.any(Object)
    );
  });

  test('should debounce multiple changes', async () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
      functions: {},
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    renderHook(() => useAutoSave());

    // Make multiple changes rapidly
    act(() => {
      useEditorStore.getState().updateDialog(filePath, 'TestDialog', {
        properties: { npc: 'Change1' },
      });
    });

    jest.advanceTimersByTime(500);

    act(() => {
      useEditorStore.getState().updateDialog(filePath, 'TestDialog', {
        properties: { npc: 'Change2' },
      });
    });

    jest.advanceTimersByTime(500);

    act(() => {
      useEditorStore.getState().updateDialog(filePath, 'TestDialog', {
        properties: { npc: 'Change3' },
      });
    });

    // Should not have saved yet
    expect(mockSaveFile).not.toHaveBeenCalled();

    // Advance time past the debounce period
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    // Should only save once with final state
    expect(mockSaveFile).toHaveBeenCalledTimes(1);
    expect(mockSaveFile).toHaveBeenCalledWith(
      filePath,
      expect.objectContaining({
        dialogs: expect.objectContaining({
          TestDialog: { properties: { npc: 'Change3' } },
        }),
      }),
      expect.any(Object)
    );
  });

  test('should not save when auto-save is disabled', async () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
      functions: {},
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
      autoSaveEnabled: false,
    });

    renderHook(() => useAutoSave());

    // Make file dirty
    act(() => {
      useEditorStore.getState().updateDialog(filePath, 'TestDialog', {
        properties: { npc: 'UpdatedNPC' },
      });
    });

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  test('should track last auto-saved timestamp', async () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
      functions: {},
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: false,
        lastSaved: new Date(Date.now() - 60000), // 1 minute ago
      }]]),
      activeFile: filePath,
    });

    renderHook(() => useAutoSave());

    // Make file dirty
    act(() => {
      useEditorStore.getState().updateDialog(filePath, 'TestDialog', {
        properties: { npc: 'UpdatedNPC' },
      });
    });

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    // After auto-save, lastSaved should be updated
    const fileState = useEditorStore.getState().openFiles.get(filePath);
    expect(fileState?.lastSaved.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  test('should save all dirty files', async () => {
    const filePath1 = 'test1.d';
    const filePath2 = 'test2.d';
    const semanticModel1 = {
      dialogs: { Dialog1: { properties: { npc: 'NPC1' } } },
      functions: {},
    };
    const semanticModel2 = {
      dialogs: { Dialog2: { properties: { npc: 'NPC2' } } },
      functions: {},
    };

    useEditorStore.setState({
      openFiles: new Map([
        [filePath1, {
          filePath: filePath1,
          semanticModel: semanticModel1,
          isDirty: true,
          lastSaved: new Date(),
        }],
        [filePath2, {
          filePath: filePath2,
          semanticModel: semanticModel2,
          isDirty: true,
          lastSaved: new Date(),
        }],
      ]),
      activeFile: filePath1,
    });

    renderHook(() => useAutoSave());

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    expect(mockSaveFile).toHaveBeenCalledTimes(2);
  });

  test('should not save files with errors', async () => {
    const filePath = 'test.d';
    const semanticModel = {
      dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
      functions: {},
      hasErrors: true,
      errors: [{ message: 'Syntax error', line: 1, column: 1 }],
    };

    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel,
        isDirty: true,
        lastSaved: new Date(),
        hasErrors: true,
        errors: [{ message: 'Syntax error', line: 1, column: 1 }],
      }]]),
      activeFile: filePath,
    });

    renderHook(() => useAutoSave());

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  test('does not auto-save a file that is in external conflict', async () => {
    const filePath = 'conflict.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: {
          dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
          functions: {},
        },
        isDirty: true,
        lastSaved: new Date(),
        externalConflict: { detectedAt: new Date().toISOString() },
      }]]),
      activeFile: filePath,
    });

    renderHook(() => useAutoSave());

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  test('keeps a file dirty when it is edited while a save is in flight', async () => {
    const filePath = 'test.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: {
          dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
          functions: {},
        },
        isDirty: true,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    let resolveSave!: (value: { success: boolean }) => void;
    mockSaveFile.mockImplementationOnce(
      () => new Promise<{ success: boolean }>((resolve) => { resolveSave = resolve; }) as any
    );

    renderHook(() => useAutoSave());

    // Trigger the debounced save; it stays pending
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });
    expect(mockSaveFile).toHaveBeenCalledTimes(1);

    // Edit the file while the save is still in flight
    act(() => {
      useEditorStore.getState().updateDialog(filePath, 'TestDialog', {
        properties: { npc: 'EditedDuringSave' },
      });
    });

    // Complete the in-flight save
    await act(async () => {
      resolveSave({ success: true });
    });

    // The mid-flight edit is NOT on disk — the file must stay dirty
    expect(useEditorStore.getState().getFileState(filePath)?.isDirty).toBe(true);
  });

  test('marks a timed-out save with saveError and keeps the file dirty', async () => {
    const filePath = 'timeout.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: {
          dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
          functions: {},
        },
        isDirty: true,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    mockSaveFile.mockRejectedValueOnce(new Error('PARSE_TIMEOUT: parser did not respond'));

    renderHook(() => useAutoSave());

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.isDirty).toBe(true);
    expect(fileState?.saveError?.kind).toBe('timeout');
    expect(mockSaveFile).toHaveBeenCalledTimes(1);
  });

  test('marks an encoding-loss save with saveError kind encoding and keeps the file dirty', async () => {
    const filePath = 'encoding.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: {
          dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
          functions: {},
        },
        isDirty: true,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    mockSaveFile.mockRejectedValueOnce(new Error('ENCODING_LOSS: character "ł" at position 5'));

    renderHook(() => useAutoSave());

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.isDirty).toBe(true);
    expect(fileState?.saveError?.kind).toBe('encoding');
    expect(mockSaveFile).toHaveBeenCalledTimes(1);
  });

  test('fileStore.saveFile records saveError and keeps the file dirty on a classifiable rejection', async () => {
    const filePath = 'manual.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: {
          dialogs: { TestDialog: { properties: { npc: 'NPC1' } } },
          functions: {},
        },
        isDirty: true,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    mockSaveFile.mockRejectedValueOnce(new Error('PARSER_CRASHED: worker died'));

    await expect(useEditorStore.getState().saveFile(filePath)).rejects.toThrow('PARSER_CRASHED');

    const fileState = useEditorStore.getState().getFileState(filePath);
    expect(fileState?.isDirty).toBe(true);
    expect(fileState?.saveError?.kind).toBe('worker-crashed');
  });

  test('should return auto-save status', () => {
    const { result } = renderHook(() => useAutoSave());

    expect(result.current).toHaveProperty('isAutoSaving');
    expect(result.current).toHaveProperty('lastAutoSaveTime');
  });

  test('flushes pending debounced edits before serializing the model (N4)', async () => {
    const filePath = 'flush.d';
    useEditorStore.setState({
      openFiles: new Map([[filePath, {
        filePath,
        semanticModel: {
          dialogs: { TestDialog: { properties: { npc: 'PENDING' } } },
          functions: {},
        },
        isDirty: true,
        lastSaved: new Date(),
      }]]),
      activeFile: filePath,
    });

    // A registered flusher commits a still-pending debounced edit into the
    // store, exactly as a mounted condition/action card would at save time.
    const unregister = registerPendingEditFlusher(() => {
      useEditorStore.getState().updateDialog(filePath, 'TestDialog', {
        properties: { npc: 'FLUSHED' },
      });
    });

    try {
      renderHook(() => useAutoSave());

      await act(async () => {
        jest.advanceTimersByTime(2500);
      });

      // The auto-save tick must have drained the flusher first, so the saved
      // model carries the flushed value — not the pre-flush 'PENDING'.
      expect(mockSaveFile).toHaveBeenCalledWith(
        filePath,
        expect.objectContaining({
          dialogs: expect.objectContaining({
            TestDialog: { properties: { npc: 'FLUSHED' } },
          }),
        }),
        expect.any(Object)
      );
    } finally {
      unregister();
    }
  });
});
