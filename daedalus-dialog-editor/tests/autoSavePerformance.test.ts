
import { describe, test, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { useEditorStore } from '../src/renderer/store/editorStore';
import { useAutoSave } from '../src/renderer/hooks/useAutoSave';
import { renderHook, act } from '@testing-library/react';

// Spy on the window.editorAPI.saveFile
const mockSaveFile = jest.spyOn(window.editorAPI, 'saveFile');

describe('Auto-save Performance', () => {
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
    // Mock successful save
    mockSaveFile.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should minimize state updates when saving multiple files', async () => {
    // Setup multiple dirty files
    const filePaths = ['file1.d', 'file2.d', 'file3.d', 'file4.d', 'file5.d'];
    const initialMap = new Map();

    filePaths.forEach(filePath => {
      initialMap.set(filePath, {
        filePath,
        semanticModel: { dialogs: {}, functions: {} },
        isDirty: true,
        lastSaved: new Date(),
        hasErrors: false
      });
    });

    useEditorStore.setState({
      openFiles: initialMap,
      activeFile: filePaths[0],
    });

    let updateCount = 0;
    const unsubscribe = useEditorStore.subscribe(() => {
      updateCount++;
    });

    renderHook(() => useAutoSave());

    // Trigger auto-save
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    unsubscribe();

    console.log(`State updates during auto-save: ${updateCount}`);

    // We expect 5 calls to saveFile
    expect(mockSaveFile).toHaveBeenCalledTimes(5);

    // Expect significant reduction in state updates
    // Ideally 1 update for all files.
    // Note: The counter might be higher if setIsAutoSaving triggers updates to store,
    // but setIsAutoSaving uses useState so it doesn't affect useEditorStore.
    expect(updateCount).toBe(1);
  });
});
