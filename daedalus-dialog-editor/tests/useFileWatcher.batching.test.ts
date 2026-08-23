/**
 * P0 perf: external change events must be batched.
 *
 * A bulk operation (git checkout touching hundreds of files) fires one
 * fileWatcher:changed event per file. The hook buffers them for a short
 * window, dedupes by path, re-parses with bounded concurrency, and applies
 * the whole batch through a single projectStore.updateFileModels call — one
 * parsedFiles clone, one parseGeneration bump, at most one re-merge.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileWatcher } from '../src/renderer/hooks/useFileWatcher';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { useFileStore } from '../src/renderer/store/fileStore';
import type { FileChangeEvent } from '../src/renderer/types/global';

const PROJ_PATH = 'C:/project';
const FILE_A = 'C:/project/DIA_A.d';
const FILE_B = 'C:/project/DIA_B.d';
const FILE_C = 'C:/project/DIA_C.d';

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

let capturedOnFileChanged: ((event: FileChangeEvent) => void) | null = null;

const mockStartFileWatcher = jest.spyOn(window.editorAPI, 'startFileWatcher');
const mockStopFileWatcher = jest.spyOn(window.editorAPI, 'stopFileWatcher');
const mockParseDialogFile = jest.spyOn(window.editorAPI, 'parseDialogFile');

jest.spyOn(window.editorAPI, 'onFileChanged').mockImplementation((cb) => {
  capturedOnFileChanged = cb as (event: FileChangeEvent) => void;
  return () => { capturedOnFileChanged = null; };
});

const modelFor = (filePath: string) => ({
  ...EMPTY_MODEL,
  dialogs: {
    [`DIA_${filePath.slice(-3, -2)}`]: {
      name: `DIA_${filePath.slice(-3, -2)}`,
      properties: { npc: 'TestNPC' },
    },
  },
});

beforeEach(() => {
  capturedOnFileChanged = null;
  mockStartFileWatcher.mockClear().mockResolvedValue(undefined as any);
  mockStopFileWatcher.mockClear().mockResolvedValue(undefined as any);
  mockParseDialogFile.mockClear().mockImplementation(async (filePath: string) => modelFor(filePath) as any);

  useProjectStore.getState().closeProject();
  useProjectStore.setState({
    projectPath: PROJ_PATH,
    projectName: 'TestProject',
    allDialogFiles: [FILE_A, FILE_B, FILE_C],
    dialogIndex: new Map([
      ['TestNPC', [
        { dialogName: 'DIA_A', npc: 'TestNPC', filePath: FILE_A },
        { dialogName: 'DIA_B', npc: 'TestNPC', filePath: FILE_B },
        { dialogName: 'DIA_C', npc: 'TestNPC', filePath: FILE_C },
      ]],
    ]),
  });
  useFileStore.setState({ openFiles: new Map(), activeFile: null });
});

async function setupHook() {
  const { unmount } = renderHook(() => useFileWatcher());
  await waitFor(() => expect(capturedOnFileChanged).not.toBeNull());
  return { unmount };
}

const emit = (event: FileChangeEvent) => {
  act(() => { capturedOnFileChanged!(event); });
};

describe('useFileWatcher — change batching', () => {
  test('N change events in one window: one parse per unique path, one store cascade', async () => {
    const { unmount } = await setupHook();
    const generationBefore = useProjectStore.getState().parseGeneration;

    let parsedFilesChanges = 0;
    let lastSeen = useProjectStore.getState().parsedFiles;
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (state.parsedFiles !== lastSeen) {
        parsedFilesChanges += 1;
        lastSeen = state.parsedFiles;
      }
    });

    // 5 events, 3 unique paths, all within the buffer window.
    emit({ type: 'change', filePath: FILE_A });
    emit({ type: 'change', filePath: FILE_B });
    emit({ type: 'change', filePath: FILE_A });
    emit({ type: 'change', filePath: FILE_C });
    emit({ type: 'change', filePath: FILE_B });

    // Nothing is parsed synchronously — events are buffered.
    expect(mockParseDialogFile).not.toHaveBeenCalled();

    await act(async () => {
      await waitFor(
        () => expect(useProjectStore.getState().parseGeneration).toBe(generationBefore + 1),
        { timeout: 2000 }
      );
    });
    unsubscribe();

    expect(mockParseDialogFile).toHaveBeenCalledTimes(3);
    expect(parsedFilesChanges).toBe(1);
    const { parsedFiles, parseGeneration } = useProjectStore.getState();
    expect(parseGeneration).toBe(generationBefore + 1);
    expect(parsedFiles.has(FILE_A)).toBe(true);
    expect(parsedFiles.has(FILE_B)).toBe(true);
    expect(parsedFiles.has(FILE_C)).toBe(true);
    unmount();
  });

  test('a batch touching the selected NPC re-merges exactly once', async () => {
    useProjectStore.setState({ selectedNpc: 'TestNPC' });
    const { unmount } = await setupHook();
    const generationBefore = useProjectStore.getState().parseGeneration;

    let mergedChanges = 0;
    let lastMerged = useProjectStore.getState().mergedSemanticModel;
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (state.mergedSemanticModel !== lastMerged) {
        mergedChanges += 1;
        lastMerged = state.mergedSemanticModel;
      }
    });

    emit({ type: 'change', filePath: FILE_A });
    emit({ type: 'change', filePath: FILE_B });
    emit({ type: 'change', filePath: FILE_C });

    await act(async () => {
      await waitFor(
        () => expect(useProjectStore.getState().parseGeneration).toBe(generationBefore + 1),
        { timeout: 2000 }
      );
    });
    unsubscribe();

    expect(mergedChanges).toBe(1);
    unmount();
  });

  test('an unlink cancels a buffered change for the same path', async () => {
    const { unmount } = await setupHook();

    emit({ type: 'change', filePath: FILE_A });
    emit({ type: 'unlink', filePath: FILE_A });

    // Ride out the batch window plus flush.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    // The buffered change must not resurrect the removed file with a parse.
    expect(mockParseDialogFile).not.toHaveBeenCalled();
    const cached = useProjectStore.getState().parsedFiles.get(FILE_A);
    expect(Object.keys(cached?.semanticModel.dialogs ?? {})).toHaveLength(0);
    unmount();
  });

  test('unmount discards buffered changes', async () => {
    const { unmount } = await setupHook();

    emit({ type: 'change', filePath: FILE_A });
    unmount();

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockParseDialogFile).not.toHaveBeenCalled();
  });
});
