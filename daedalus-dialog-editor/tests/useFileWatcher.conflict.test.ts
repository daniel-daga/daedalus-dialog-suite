/**
 * Tests for external-change conflict handling in useFileWatcher (E4 / N3 / N5).
 *
 *   - 'change' on a dirty open file    → externalConflict marked, no reload
 *   - 'change' on a clean BACKGROUND   → reloaded in place, activeFile unchanged (N3)
 *   - 'unlink' on a dirty open file    → FileState retained + fileMissing conflict (N5)
 *   - resolveExternalConflict keepMine → save with overwriteExternal, clear conflict
 *   - resolveExternalConflict reloadTheirs → reload from disk, clear conflict
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileWatcher } from '../src/renderer/hooks/useFileWatcher';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useFileStore } from '../src/renderer/store/fileStore';
import type { FileChangeEvent } from '../src/renderer/types/global';

const PROJ_PATH = 'C:/project';
const FILE_A = 'C:/project/DIA_Test.d';
const FILE_B = 'C:/project/DIA_Other.d';

const EMPTY_MODEL = {
  dialogs: {},
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  items: {},
  npcs: {},
  animations: {},
  hasErrors: false,
  errors: [],
};

const PARSED_MODEL = {
  ...EMPTY_MODEL,
  dialogs: {
    DIA_Test: {
      name: 'DIA_Test',
      properties: { npc: 'TestNPC', information: 'DIA_Test_Info' },
    },
  },
};

let capturedOnFileChanged: ((event: FileChangeEvent) => void) | null = null;

const mockStartFileWatcher = jest.spyOn(window.editorAPI, 'startFileWatcher');
const mockStopFileWatcher = jest.spyOn(window.editorAPI, 'stopFileWatcher');
const mockParseDialogFile = jest.spyOn(window.editorAPI, 'parseDialogFile');
const mockReadFile = jest.spyOn(window.editorAPI, 'readFile');
const mockParseSource = jest.spyOn(window.editorAPI, 'parseSource');
const mockSaveFile = jest.spyOn(window.editorAPI, 'saveFile');

jest.spyOn(window.editorAPI, 'onFileChanged').mockImplementation((cb) => {
  capturedOnFileChanged = cb as (event: FileChangeEvent) => void;
  return () => { capturedOnFileChanged = null; };
});

beforeEach(() => {
  capturedOnFileChanged = null;
  mockStartFileWatcher.mockClear().mockResolvedValue(undefined as any);
  mockStopFileWatcher.mockClear().mockResolvedValue(undefined as any);
  mockParseDialogFile.mockClear().mockResolvedValue(PARSED_MODEL as any);
  mockReadFile.mockClear().mockResolvedValue('// reloaded source' as any);
  mockParseSource.mockClear().mockResolvedValue({ ...EMPTY_MODEL } as any);
  mockSaveFile.mockClear().mockResolvedValue({ success: true, validationResult: { isValid: true, errors: [], warnings: [] } } as any);

  useProjectStore.setState({
    projectPath: PROJ_PATH,
    projectName: 'TestProject',
    parsedFiles: new Map(),
    allDialogFiles: [],
    dialogIndex: new Map(),
    npcList: [],
    npcPrototypes: [],
    routineList: [],
    questFiles: [],
    selectedNpc: null,
    mergedSemanticModel: EMPTY_MODEL as any,
    isLoading: false,
    loadError: null,
    isIngesting: false,
    abortIngestion: null,
    isIngestedFilesOpen: false,
  });

  useFileStore.setState({
    openFiles: new Map(),
    activeFile: null,
    project: null,
    pendingValidation: null,
    codeSettings: {
      indentChar: '\t',
      includeComments: true,
      sectionHeaders: true,
      uppercaseKeywords: true,
    },
    autoSaveEnabled: true,
    autoSaveInterval: 2000,
  });
});

async function setupHook() {
  const { unmount } = renderHook(() => useFileWatcher());
  await waitFor(() => expect(capturedOnFileChanged).not.toBeNull());
  return { unmount };
}

async function emitFileChange(event: FileChangeEvent): Promise<void> {
  await act(async () => {
    capturedOnFileChanged!(event);
    await Promise.resolve();
  });
}

describe('useFileWatcher — external conflict (change)', () => {
  test('marks an external conflict on a dirty open file instead of reloading', async () => {
    const openFileSpy = jest.spyOn(useFileStore.getState(), 'openFile');
    useFileStore.setState({
      activeFile: FILE_A,
      openFiles: new Map([[FILE_A, {
        filePath: FILE_A,
        semanticModel: PARSED_MODEL as any,
        isDirty: true,
        lastSaved: new Date(),
        originalCode: '// original',
      }]]),
    });

    const { unmount } = await setupHook();
    await emitFileChange({ type: 'change', filePath: FILE_A });

    expect(openFileSpy).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();

    const fs = useFileStore.getState().openFiles.get(FILE_A);
    expect(fs?.externalConflict).toBeDefined();
    expect(fs?.externalConflict?.fileMissing).toBeFalsy();
    expect(fs?.isDirty).toBe(true);
    unmount();
  });

  test('reloads a clean BACKGROUND file in place without stealing the active file (N3)', async () => {
    useFileStore.setState({
      activeFile: FILE_A,
      openFiles: new Map([
        [FILE_A, { filePath: FILE_A, semanticModel: PARSED_MODEL as any, isDirty: true, lastSaved: new Date(), originalCode: '// a' }],
        [FILE_B, { filePath: FILE_B, semanticModel: PARSED_MODEL as any, isDirty: false, lastSaved: new Date(), originalCode: '// old B' }],
      ]),
    });

    const { unmount } = await setupHook();
    await emitFileChange({ type: 'change', filePath: FILE_B });

    // The background file was reloaded from disk...
    expect(mockReadFile).toHaveBeenCalledWith(FILE_B);
    const fsB = useFileStore.getState().openFiles.get(FILE_B);
    expect(fsB?.originalCode).toBe('// reloaded source');
    expect(fsB?.isDirty).toBe(false);
    // ...but the active file was NOT stolen (fails today: openFile sets activeFile).
    expect(useFileStore.getState().activeFile).toBe(FILE_A);
    unmount();
  });
});

describe('useFileWatcher — external conflict (unlink, N5)', () => {
  test('retains a dirty file with a fileMissing conflict on unlink', async () => {
    useFileStore.setState({
      activeFile: FILE_A,
      openFiles: new Map([[FILE_A, {
        filePath: FILE_A,
        semanticModel: PARSED_MODEL as any,
        isDirty: true,
        lastSaved: new Date(),
        originalCode: '// original',
      }]]),
    });

    const { unmount } = await setupHook();
    await emitFileChange({ type: 'unlink', filePath: FILE_A });

    const fs = useFileStore.getState().openFiles.get(FILE_A);
    expect(fs).toBeDefined();
    expect(fs?.externalConflict?.fileMissing).toBe(true);
    unmount();
  });

  test('still closes a clean file on unlink', async () => {
    useFileStore.setState({
      activeFile: FILE_A,
      openFiles: new Map([[FILE_A, {
        filePath: FILE_A,
        semanticModel: PARSED_MODEL as any,
        isDirty: false,
        lastSaved: new Date(),
        originalCode: '// original',
      }]]),
    });

    const { unmount } = await setupHook();
    await emitFileChange({ type: 'unlink', filePath: FILE_A });

    expect(useFileStore.getState().openFiles.has(FILE_A)).toBe(false);
    unmount();
  });
});

describe('resolveExternalConflict', () => {
  test('keepMine saves with overwriteExternal and clears the conflict', async () => {
    useFileStore.setState({
      activeFile: FILE_A,
      openFiles: new Map([[FILE_A, {
        filePath: FILE_A,
        semanticModel: PARSED_MODEL as any,
        isDirty: true,
        lastSaved: new Date(),
        originalCode: '// original',
        externalConflict: { detectedAt: 'x' },
      }]]),
    });

    await act(async () => {
      await useFileStore.getState().resolveExternalConflict(FILE_A, 'keepMine');
    });

    expect(mockSaveFile).toHaveBeenCalledWith(
      FILE_A,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ overwriteExternal: true })
    );
    const fs = useFileStore.getState().openFiles.get(FILE_A);
    expect(fs?.externalConflict).toBeUndefined();
  });

  test('reloadTheirs reloads from disk and clears the conflict', async () => {
    useFileStore.setState({
      activeFile: FILE_A,
      openFiles: new Map([[FILE_A, {
        filePath: FILE_A,
        semanticModel: PARSED_MODEL as any,
        isDirty: true,
        lastSaved: new Date(),
        originalCode: '// original',
        externalConflict: { detectedAt: 'x' },
      }]]),
    });

    await act(async () => {
      await useFileStore.getState().resolveExternalConflict(FILE_A, 'reloadTheirs');
    });

    expect(mockReadFile).toHaveBeenCalledWith(FILE_A);
    const fs = useFileStore.getState().openFiles.get(FILE_A);
    expect(fs?.externalConflict).toBeUndefined();
    expect(fs?.isDirty).toBe(false);
    expect(fs?.originalCode).toBe('// reloaded source');
  });

  test('reloadTheirs on a fileMissing conflict discards by closing the file', async () => {
    useFileStore.setState({
      activeFile: FILE_A,
      openFiles: new Map([[FILE_A, {
        filePath: FILE_A,
        semanticModel: PARSED_MODEL as any,
        isDirty: true,
        lastSaved: new Date(),
        originalCode: '// original',
        externalConflict: { detectedAt: 'x', fileMissing: true },
      }]]),
    });

    await act(async () => {
      await useFileStore.getState().resolveExternalConflict(FILE_A, 'reloadTheirs');
    });

    expect(useFileStore.getState().openFiles.has(FILE_A)).toBe(false);
  });

  test('saveFile refuses a conflicted file unless overwriteExternal is set', async () => {
    useFileStore.setState({
      activeFile: FILE_A,
      openFiles: new Map([[FILE_A, {
        filePath: FILE_A,
        semanticModel: PARSED_MODEL as any,
        isDirty: true,
        lastSaved: new Date(),
        originalCode: '// original',
        externalConflict: { detectedAt: 'x' },
      }]]),
    });

    const result = await useFileStore.getState().saveFile(FILE_A);
    expect(result.success).toBe(false);
    expect(mockSaveFile).not.toHaveBeenCalled();

    // Still dirty and still conflicted.
    const fs = useFileStore.getState().openFiles.get(FILE_A);
    expect(fs?.isDirty).toBe(true);
    expect(fs?.externalConflict).toBeDefined();
  });
});
