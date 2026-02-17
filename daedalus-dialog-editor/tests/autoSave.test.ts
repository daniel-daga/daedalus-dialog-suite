/**
 * Tests for auto-save feature
 *
 * TDD: Writing tests first before implementing the feature
 */

import { describe, test, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useAutoSave } from '../src/renderer/hooks/useAutoSave';
import { renderHook, act } from '@testing-library/react';

// Spy on the window.editorAPI.saveFile that is set up in tests/setup.ts
const mockSaveFile = jest.spyOn(window.editorAPI, 'saveFile');

const createQuestModel = (value: string) => ({
  dialogs: {},
  functions: {
    DIA_Test_Info: {
      name: 'DIA_Test_Info',
      returnType: 'VOID',
      actions: [{
        type: 'SetVariableAction',
        variableName: 'MIS_TEST',
        operator: '=',
        value
      }],
      conditions: [],
      calls: []
    }
  },
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

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

    const { result } = renderHook(() => useAutoSave());

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

  test('should return auto-save status', () => {
    const { result } = renderHook(() => useAutoSave());

    expect(result.current).toHaveProperty('isAutoSaving');
    expect(result.current).toHaveProperty('lastAutoSaveTime');
  });

  test('auto-saves files dirtied by quest batch apply', async () => {
    const filePath1 = 'quest-batch-1.d';
    const filePath2 = 'quest-batch-2.d';

    useEditorStore.setState({
      openFiles: new Map([
        [filePath1, {
          filePath: filePath1,
          semanticModel: createQuestModel('LOG_RUNNING'),
          isDirty: false,
          lastSaved: new Date(),
          hasErrors: false
        }],
        [filePath2, {
          filePath: filePath2,
          semanticModel: createQuestModel('LOG_RUNNING'),
          isDirty: false,
          lastSaved: new Date(),
          hasErrors: false
        }]
      ]),
      questHistory: new Map(),
      questBatchHistory: { past: [], future: [] },
      activeFile: filePath1
    });

    renderHook(() => useAutoSave());

    act(() => {
      useEditorStore.getState().applyQuestModelsWithHistory([
        { filePath: filePath1, model: createQuestModel('LOG_SUCCESS') },
        { filePath: filePath2, model: createQuestModel('LOG_FAILED') }
      ]);
    });

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    expect(mockSaveFile).toHaveBeenCalledWith(
      filePath1,
      expect.objectContaining({
        functions: expect.objectContaining({
          DIA_Test_Info: expect.objectContaining({
            actions: expect.arrayContaining([expect.objectContaining({ value: 'LOG_SUCCESS' })])
          })
        })
      }),
      expect.any(Object)
    );
    expect(mockSaveFile).toHaveBeenCalledWith(
      filePath2,
      expect.objectContaining({
        functions: expect.objectContaining({
          DIA_Test_Info: expect.objectContaining({
            actions: expect.arrayContaining([expect.objectContaining({ value: 'LOG_FAILED' })])
          })
        })
      }),
      expect.any(Object)
    );

    const next = useEditorStore.getState();
    expect(next.getFileState(filePath1)?.isDirty).toBe(false);
    expect(next.getFileState(filePath2)?.isDirty).toBe(false);
  });

  test('auto-saves reverted model after undoing last quest batch', async () => {
    const filePath = 'quest-undo.d';
    useEditorStore.setState({
      openFiles: new Map([
        [filePath, {
          filePath,
          semanticModel: createQuestModel('LOG_RUNNING'),
          isDirty: false,
          lastSaved: new Date(),
          hasErrors: false
        }]
      ]),
      questHistory: new Map(),
      questBatchHistory: { past: [], future: [] },
      activeFile: filePath
    });

    renderHook(() => useAutoSave());

    act(() => {
      useEditorStore.getState().applyQuestModelsWithHistory([
        { filePath, model: createQuestModel('LOG_SUCCESS') }
      ]);
      useEditorStore.getState().undoLastQuestBatch();
    });

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    expect(mockSaveFile).toHaveBeenCalledWith(
      filePath,
      expect.objectContaining({
        functions: expect.objectContaining({
          DIA_Test_Info: expect.objectContaining({
            actions: expect.arrayContaining([expect.objectContaining({ value: 'LOG_RUNNING' })])
          })
        })
      }),
      expect.any(Object)
    );
  });
});
