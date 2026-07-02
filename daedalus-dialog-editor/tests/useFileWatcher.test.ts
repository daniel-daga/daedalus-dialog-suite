/**
 * Tests for useFileWatcher hook
 *
 * Verifies that external file-change events forwarded from the main process
 * are handled correctly by the renderer:
 *
 *   - 'change' on a dirty open file  → skipped to protect unsaved work
 *   - 'change' on a clean open file  → file is re-opened (reloaded)
 *   - 'change' on a background file  → re-parsed and injected into projectStore
 *   - 'add'    → registered in projectStore and parsed into the cache
 *   - 'unlink' on an open file       → closed + projectStore cache cleared
 *   - 'unlink' on a background file  → projectStore cache cleared
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileWatcher } from '../src/renderer/hooks/useFileWatcher';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useFileStore } from '../src/renderer/store/fileStore';
import type { FileChangeEvent } from '../src/renderer/types/global';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let capturedOnFileChanged: ((event: FileChangeEvent) => void) | null = null;

const mockStartFileWatcher = jest.spyOn(window.editorAPI, 'startFileWatcher');
const mockStopFileWatcher = jest.spyOn(window.editorAPI, 'stopFileWatcher');
const mockParseDialogFile = jest.spyOn(window.editorAPI, 'parseDialogFile');
const mockReadFile = jest.spyOn(window.editorAPI, 'readFile');
const mockWriteFile = jest.spyOn(window.editorAPI, 'writeFile');

// Capture the callback registered by the hook so we can fire test events
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
  mockWriteFile.mockClear().mockResolvedValue({ success: true } as any);

  // Reset stores to a clean state
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

// ---------------------------------------------------------------------------
// Helper to render the hook with a live project path and get the event emitter
// ---------------------------------------------------------------------------

async function setupHook() {
  const { unmount } = renderHook(() => useFileWatcher());
  // Wait for the useEffect to run
  await waitFor(() => expect(capturedOnFileChanged).not.toBeNull());
  return { unmount };
}

async function emitFileChange(event: FileChangeEvent): Promise<void> {
  await act(async () => {
    capturedOnFileChanged!(event);
    // Allow promises to resolve
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFileWatcher hook lifecycle', () => {
  test('starts the file watcher when a project is open', async () => {
    const { unmount } = await setupHook();
    expect(mockStartFileWatcher).toHaveBeenCalledWith(PROJ_PATH);
    unmount();
  });

  test('stops the file watcher on unmount', async () => {
    const { unmount } = await setupHook();
    unmount();
    await waitFor(() => expect(mockStopFileWatcher).toHaveBeenCalled());
  });

  test('does not start the file watcher when no project is open', async () => {
    useProjectStore.setState({ projectPath: null });
    renderHook(() => useFileWatcher());
    // Give the effect time to run
    await act(async () => { await Promise.resolve(); });
    expect(mockStartFileWatcher).not.toHaveBeenCalled();
    expect(mockStopFileWatcher).toHaveBeenCalled(); // stopWatching is always called as cleanup
  });
});

describe('useFileWatcher — change event', () => {
  test('skips reload when the open file is dirty', async () => {
    const openFileSpy = jest.spyOn(useFileStore.getState(), 'openFile');
    useFileStore.setState({
      openFiles: new Map([[FILE_A, { filePath: FILE_A, semanticModel: PARSED_MODEL as any, isDirty: true, lastSaved: null }]]),
    });

    const { unmount } = await setupHook();
    await emitFileChange({ type: 'change', filePath: FILE_A });

    expect(openFileSpy).not.toHaveBeenCalled();
    expect(mockParseDialogFile).not.toHaveBeenCalled();
    unmount();
  });

  test('reloads the file when it is open and clean', async () => {
    useFileStore.setState({
      openFiles: new Map([[FILE_A, { filePath: FILE_A, semanticModel: PARSED_MODEL as any, isDirty: false, lastSaved: new Date() }]]),
    });

    // Track whether openFile was called by intercepting the API-level parse
    const { unmount } = await setupHook();
    await emitFileChange({ type: 'change', filePath: FILE_A });

    // fileStore.openFile reads the file source (readFile), not parseDialogFile
    expect(mockReadFile).toHaveBeenCalledWith(FILE_A);
    // parseDialogFile is NOT used for open files (openFile path is used instead)
    expect(mockParseDialogFile).not.toHaveBeenCalledWith(FILE_A);
    unmount();
  });

  test('re-parses and updates projectStore for a background file', async () => {
    const { unmount } = await setupHook();
    await emitFileChange({ type: 'change', filePath: FILE_B });

    expect(mockParseDialogFile).toHaveBeenCalledWith(FILE_B);
    const cached = useProjectStore.getState().parsedFiles.get(FILE_B);
    expect(cached).toBeDefined();
    unmount();
  });

  test('injects filePath into constants and variables from the parsed model', async () => {
    const modelWithSymbols = {
      ...PARSED_MODEL,
      constants: { TOPIC_Test: { name: 'TOPIC_Test', type: 'string', value: '"test"' } },
      variables: { MIS_Test: { name: 'MIS_Test', type: 'int' } },
    };
    mockParseDialogFile.mockResolvedValueOnce(modelWithSymbols as any);

    const { unmount } = await setupHook();
    await emitFileChange({ type: 'change', filePath: FILE_B });

    const cached = useProjectStore.getState().parsedFiles.get(FILE_B);
    expect(cached?.semanticModel.constants?.['TOPIC_Test']).toMatchObject({ filePath: FILE_B });
    expect(cached?.semanticModel.variables?.['MIS_Test']).toMatchObject({ filePath: FILE_B });
    unmount();
  });
});

describe('useFileWatcher — add event', () => {
  test('registers the new file in allDialogFiles', async () => {
    const { unmount } = await setupHook();
    await emitFileChange({ type: 'add', filePath: FILE_B });

    expect(useProjectStore.getState().allDialogFiles).toContain(FILE_B);
    unmount();
  });

  test('parses the new file and caches the model', async () => {
    const { unmount } = await setupHook();
    await emitFileChange({ type: 'add', filePath: FILE_B });

    expect(mockParseDialogFile).toHaveBeenCalledWith(FILE_B);
    const cached = useProjectStore.getState().parsedFiles.get(FILE_B);
    expect(cached).toBeDefined();
    unmount();
  });

  test('indexes dialogs from the new file into the dialog index', async () => {
    const { unmount } = await setupHook();
    await emitFileChange({ type: 'add', filePath: FILE_B });

    const dialogIndex = useProjectStore.getState().dialogIndex;
    const entries = dialogIndex.get('TestNPC');
    expect(entries).toBeDefined();
    expect(entries!.some((m) => m.dialogName === 'DIA_Test')).toBe(true);
    unmount();
  });
});

describe('useFileWatcher — add event auto-creates EXIT dialog (issue #141)', () => {
  const NPC_FILE = 'C:/project/NPC/VLK_99099_Robert.d';
  const EXISTING_DIALOG_FILE = 'C:/project/Dialoge/DIA_Alrik.d';
  const EXIT_FILE = 'C:/project/Dialoge/DIA_VLK_99099_Robert.d';

  const NPC_MODEL = {
    ...EMPTY_MODEL,
    instances: { VLK_99099_Robert: { name: 'VLK_99099_Robert', parent: 'Npc_Default' } },
  };

  const EXIT_MODEL = {
    ...EMPTY_MODEL,
    dialogs: {
      DIA_Robert_EXIT: {
        name: 'DIA_Robert_EXIT',
        properties: { npc: 'VLK_99099_Robert', information: 'DIA_Robert_EXIT_Info' },
      },
    },
  };

  beforeEach(() => {
    useProjectStore.setState({
      npcPrototypes: ['NPC_DEFAULT'],
      npcList: ['VLK_438_Alrik'],
      dialogIndex: new Map([
        ['VLK_438_Alrik', [{ dialogName: 'DIA_Alrik_Hello', npc: 'VLK_438_Alrik', filePath: EXISTING_DIALOG_FILE }]],
      ]),
    });
    mockParseDialogFile.mockImplementation(async (filePath: string) =>
      (filePath === NPC_FILE ? NPC_MODEL : EXIT_MODEL) as any
    );
    // The EXIT dialog file does not exist yet
    mockReadFile.mockRejectedValue(new Error('File not found'));
  });

  async function flushAsync(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  test('writes the EXIT dialog into the project dialog directory and indexes it', async () => {
    const { unmount } = await setupHook();
    await emitFileChange({ type: 'add', filePath: NPC_FILE });

    await waitFor(() => expect(mockWriteFile).toHaveBeenCalled());
    const [writtenPath, content] = mockWriteFile.mock.calls[0] as [string, string];
    expect(writtenPath).toBe(EXIT_FILE);
    expect(content).toContain('INSTANCE DIA_Robert_EXIT (C_INFO)');
    expect(content).toContain('npc\t\t\t= VLK_99099_Robert;');
    expect(content).toContain('AI_StopProcessInfos (self);');

    // The generated file is parsed and indexed → the NPC shows up in the
    // NPC list with its EXIT dialog without re-opening the project.
    await waitFor(() => {
      const entries = useProjectStore.getState().dialogIndex.get('VLK_99099_Robert');
      expect(entries?.some((m) => m.dialogName === 'DIA_Robert_EXIT')).toBe(true);
    });
    expect(useProjectStore.getState().npcList).toContain('VLK_99099_Robert');
    unmount();
  });

  test('does not overwrite an existing EXIT dialog file', async () => {
    mockReadFile.mockResolvedValue('// EXIT dialog already present' as any);

    const { unmount } = await setupHook();
    await emitFileChange({ type: 'add', filePath: NPC_FILE });
    await flushAsync();
    await flushAsync();

    expect(mockWriteFile).not.toHaveBeenCalled();
    unmount();
  });

  test('does not create an EXIT dialog when the NPC already has dialogs', async () => {
    mockParseDialogFile.mockResolvedValue({
      ...EMPTY_MODEL,
      instances: { VLK_438_Alrik: { name: 'VLK_438_Alrik', parent: 'Npc_Default' } },
    } as any);

    const { unmount } = await setupHook();
    await emitFileChange({ type: 'add', filePath: 'C:/project/NPC/VLK_438_Alrik.d' });
    await flushAsync();
    await flushAsync();

    expect(mockWriteFile).not.toHaveBeenCalled();
    unmount();
  });
});

describe('useFileWatcher — unlink event', () => {
  test('closes the file in fileStore if it was open', async () => {
    useFileStore.setState({
      openFiles: new Map([[FILE_A, { filePath: FILE_A, semanticModel: PARSED_MODEL as any, isDirty: false, lastSaved: new Date() }]]),
    });

    const { unmount } = await setupHook();
    await emitFileChange({ type: 'unlink', filePath: FILE_A });

    // Verify the file was removed from the open files map
    expect(useFileStore.getState().openFiles.has(FILE_A)).toBe(false);
    unmount();
  });

  test('clears the parsed-file cache in projectStore', async () => {
    // Seed the cache
    useProjectStore.getState().updateFileModel(FILE_A, PARSED_MODEL as any);

    const { unmount } = await setupHook();
    await emitFileChange({ type: 'unlink', filePath: FILE_A });

    const cached = useProjectStore.getState().parsedFiles.get(FILE_A);
    // The cache entry should be cleared to an empty model (no dialogs)
    expect(Object.keys(cached?.semanticModel.dialogs ?? {})).toHaveLength(0);
    unmount();
  });

  test('does not throw when the removed file was not open', async () => {
    // Ensure openFiles is empty (no FILE_B)
    expect(useFileStore.getState().openFiles.size).toBe(0);

    const { unmount } = await setupHook();
    await expect(emitFileChange({ type: 'unlink', filePath: FILE_B })).resolves.toBeUndefined();

    // openFiles should still be empty — nothing was closed
    expect(useFileStore.getState().openFiles.size).toBe(0);
    unmount();
  });
});
