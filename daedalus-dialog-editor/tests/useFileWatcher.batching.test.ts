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
import { registerPendingEditFlusher } from '../src/renderer/utils/pendingEditFlushRegistry';
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
const mockIndexFile = jest.spyOn(window.editorAPI, 'indexFile');

jest.spyOn(window.editorAPI, 'onFileChanged').mockImplementation((cb) => {
  capturedOnFileChanged = cb as (event: FileChangeEvent) => void;
  return () => { capturedOnFileChanged = null; };
});

const EMPTY_INDEX = {
  routineSites: [], spawnSites: [], exchangeSites: [], instances: [],
};

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
  // The change batch's one read of a file: its index and the model main parsed
  // on the way (#473).
  mockIndexFile.mockReset().mockImplementation(async (filePath: string) => ({
    index: EMPTY_INDEX, model: modelFor(filePath) as any,
  }));

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
  test('flushes a pending editor edit before deciding whether an open file can reload', async () => {
    useFileStore.setState({
      activeFile: FILE_A,
      openFiles: new Map([[FILE_A, {
        filePath: FILE_A,
        semanticModel: EMPTY_MODEL as any,
        isDirty: false,
        lastSaved: new Date(),
        originalCode: '// original',
      }]]),
    });
    const unregister = registerPendingEditFlusher(() => {
      useFileStore.setState((state) => ({
        openFiles: new Map(state.openFiles).set(FILE_A, {
          ...state.openFiles.get(FILE_A)!,
          isDirty: true,
        }),
      }));
    });
    const { unmount } = await setupHook();

    emit({ type: 'change', filePath: FILE_A });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(useFileStore.getState().openFiles.get(FILE_A)?.externalConflict).toBeDefined();
    expect(mockParseDialogFile).not.toHaveBeenCalled();
    unregister();
    unmount();
  });

  // #449: the reload decision is made per file, after every earlier await in
  // the batch. An edit committed to file B while file A is still reading must
  // be seen — B is dirty now, so it takes the conflict path, not the disk copy.
  test('an edit committed while another file reloads survives the batch', async () => {
    const parked = new Map<string, (value: { content: string; version: string }) => void>();
    const readVersioned = jest.spyOn(window.editorAPI, 'readFileVersioned')
      .mockImplementation((filePath: string) =>
        new Promise((resolve) => { parked.set(filePath, resolve); }) as any);

    const cleanState = (filePath: string) => {
      const model = modelFor(filePath);
      return {
        filePath,
        semanticModel: model as any,
        savedModel: model as any,
        isDirty: false,
        lastSaved: new Date(),
        originalCode: `// ${filePath}`,
        diskVersion: 'v1',
      };
    };
    useFileStore.setState({
      activeFile: FILE_A,
      openFiles: new Map([
        [FILE_A, cleanState(FILE_A)],
        [FILE_B, cleanState(FILE_B)],
      ]) as any,
    });
    const { unmount } = await setupHook();

    emit({ type: 'change', filePath: FILE_A });
    emit({ type: 'change', filePath: FILE_B });
    await act(async () => {
      await waitFor(() => expect(parked.has(FILE_A)).toBe(true), { timeout: 2000 });
    });

    // The keystroke lands while A's disk read is still parked.
    act(() => {
      useFileStore.getState().updateModel(FILE_B, {
        ...modelFor(FILE_B),
        dialogs: { DIA_EDITED: { name: 'DIA_EDITED', properties: { npc: 'TestNPC' } } },
      } as any);
    });

    await act(async () => {
      parked.get(FILE_A)!({ content: '// A re-read from disk', version: 'v2' });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const fileB = useFileStore.getState().openFiles.get(FILE_B)!;
    // B was never re-read: the decision is made from live state, not a snapshot.
    expect(parked.has(FILE_B)).toBe(false);
    expect(fileB.externalConflict).toBeDefined();
    expect(Object.keys(fileB.semanticModel.dialogs)).toEqual(['DIA_EDITED']);
    expect(fileB.isDirty).toBe(true);
    readVersioned.mockRestore();
    unmount();
  });

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

    expect(mockIndexFile).toHaveBeenCalledTimes(3);
    // The index read is the batch's only parse: the models it returned are
    // what the cache holds, so nothing asks for a second parse of the same path.
    expect(mockParseDialogFile).not.toHaveBeenCalled();
    expect(parsedFilesChanges).toBe(1);
    const { parsedFiles, parseGeneration } = useProjectStore.getState();
    expect(parseGeneration).toBe(generationBefore + 1);
    expect(parsedFiles.has(FILE_A)).toBe(true);
    expect(parsedFiles.has(FILE_B)).toBe(true);
    expect(parsedFiles.has(FILE_C)).toBe(true);
    unmount();
  });

  // #319: the batch is re-indexed the way it is re-parsed — once per unique
  // path, and applied to the site indexes in one update, not one per file.
  test('N change events in one window: one index read per unique path, one site-index update', async () => {
    mockIndexFile.mockImplementation(async (filePath: string) => ({
      index: {
        routineSites: [{ routine: 'RTN_X', startMinute: 0, endMinute: 60, waypoint: 'WP', filePath, line: 1 }],
        spawnSites: [], exchangeSites: [], instances: [],
      },
      model: modelFor(filePath) as any,
    }));
    useProjectStore.setState({ routineSiteIndex: [] });
    const { unmount } = await setupHook();

    let siteIndexChanges = 0;
    let lastSeen = useProjectStore.getState().routineSiteIndex;
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (state.routineSiteIndex !== lastSeen) {
        siteIndexChanges += 1;
        lastSeen = state.routineSiteIndex;
      }
    });

    emit({ type: 'change', filePath: FILE_A });
    emit({ type: 'change', filePath: FILE_B });
    emit({ type: 'change', filePath: FILE_A });
    emit({ type: 'change', filePath: FILE_C });

    await act(async () => {
      await waitFor(
        () => expect(useProjectStore.getState().routineSiteIndex).toHaveLength(3),
        { timeout: 2000 }
      );
    });
    unsubscribe();

    expect(mockIndexFile).toHaveBeenCalledTimes(3);
    expect(siteIndexChanges).toBe(1);
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

  // #473: the batch parsed each changed file for its model and then asked main
  // to read and parse the same path again for its FileIndex — two parses of one
  // file. The index read already parses it, so its model is the one used.
  test('a changed file is parsed once: the batch index read supplies the model', async () => {
    const { unmount } = await setupHook();

    emit({ type: 'change', filePath: FILE_A });
    await act(async () => {
      await waitFor(() => expect(mockIndexFile).toHaveBeenCalledTimes(1), { timeout: 2000 });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(mockParseDialogFile).not.toHaveBeenCalled();
    // The one parse's model is what the cache ends up holding.
    expect(Object.keys(useProjectStore.getState().parsedFiles.get(FILE_A)?.semanticModel.dialogs ?? {}))
      .toEqual(['DIA_A']);
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

  // #382: a slow read of X must not land after a later batch's read of X.
  test('an older batch for a file never overwrites a newer one', async () => {
    const resolvers: Array<(model: any) => void> = [];
    mockIndexFile.mockImplementation((_filePath: string) =>
      new Promise((resolve) => {
        resolvers.push((model: any) => resolve({ index: EMPTY_INDEX, model }));
      }) as any);
    const versioned = (version: string) => ({
      ...EMPTY_MODEL,
      dialogs: { [`DIA_${version}`]: { name: `DIA_${version}`, properties: { npc: 'TestNPC' } } },
    });
    const { unmount } = await setupHook();

    emit({ type: 'change', filePath: FILE_A });
    await act(async () => {
      await waitFor(() => expect(resolvers).toHaveLength(1), { timeout: 2000 });
    });

    // The file changes again while the first parse is still running.
    emit({ type: 'change', filePath: FILE_A });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    // Finish whichever parses exist newest-first, which is the order that
    // used to let the older model win.
    await act(async () => {
      if (resolvers.length === 2) resolvers[1](versioned('NEW'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      resolvers[0](versioned('OLD'));
      await waitFor(() => expect(resolvers).toHaveLength(2), { timeout: 2000 });
      resolvers[1](versioned('NEW'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const cached = useProjectStore.getState().parsedFiles.get(FILE_A);
    expect(Object.keys(cached?.semanticModel.dialogs ?? {})).toEqual(['DIA_NEW']);
    unmount();
  });

  // #390: an unlink or add that lands while a batch for the same file is
  // already parsing must not be undone when that batch applies.
  describe('an event racing an in-flight batch', () => {
    const versioned = (version: string) => ({
      ...EMPTY_MODEL,
      dialogs: { [`DIA_${version}`]: { name: `DIA_${version}`, properties: { npc: 'TestNPC' } } },
    });
    let resolvers: Array<(model: any) => void>;
    let parseResolvers: Array<(model: any) => void>;

    beforeEach(() => {
      resolvers = [];
      parseResolvers = [];
      // The change batch's read is deferred; an added file still parses on its
      // own (§141's exit-dialog path needs the model before the index).
      mockIndexFile.mockImplementation((_filePath: string) =>
        new Promise((resolve) => {
          resolvers.push((model: any) => resolve({ index: EMPTY_INDEX, model }));
        }) as any);
      mockParseDialogFile.mockImplementation(() =>
        new Promise((resolve) => { parseResolvers.push(resolve); }) as any);
      useProjectStore.setState({ routineSiteIndex: [] });
    });

    async function startBatchFor(filePath: string) {
      emit({ type: 'change', filePath });
      await act(async () => {
        await waitFor(() => expect(resolvers).toHaveLength(1), { timeout: 2000 });
      });
    }

    test('an unlink is not undone by the batch', async () => {
      const { unmount } = await setupHook();
      await startBatchFor(FILE_A);

      emit({ type: 'unlink', filePath: FILE_A });
      await act(async () => {
        resolvers[0](versioned('OLD'));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const cached = useProjectStore.getState().parsedFiles.get(FILE_A);
      expect(Object.keys(cached?.semanticModel.dialogs ?? {})).toHaveLength(0);
      expect(useProjectStore.getState().routineSiteIndex.filter((s) => s.filePath === FILE_A)).toHaveLength(0);
      unmount();
    });

    test('an add is not undone by the batch', async () => {
      const { unmount } = await setupHook();
      await startBatchFor(FILE_A);

      // Deleted and recreated while the batch parses: the add's parse is the
      // newer one, whichever order the two reads finish in.
      emit({ type: 'add', filePath: FILE_A });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        resolvers[0](versioned('OLD'));
        await waitFor(() => expect(parseResolvers).toHaveLength(1), { timeout: 2000 });
        parseResolvers[0](versioned('NEW'));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const cached = useProjectStore.getState().parsedFiles.get(FILE_A);
      expect(Object.keys(cached?.semanticModel.dialogs ?? {})).toEqual(['DIA_NEW']);
      unmount();
    });
  });

  test('unmount discards buffered changes', async () => {
    const { unmount } = await setupHook();

    emit({ type: 'change', filePath: FILE_A });
    unmount();

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockParseDialogFile).not.toHaveBeenCalled();
  });
});

// #380: watcher work that was in flight when the project session changed
// belongs to the old project and must not land in the new one.
describe('useFileWatcher — project session change', () => {
  const PROJ_B = 'C:/projectB';
  const FILE_B1 = 'C:/projectB/DIA_Q.d';

  // The change batch's one read of a file — index and model together (#473) —
  // deferred so a project switch can land while it is in flight.
  function deferIndexes() {
    const pending = new Map<string, (model: any) => void>();
    mockIndexFile.mockImplementation((filePath: string) =>
      new Promise((resolve) => {
        pending.set(filePath, (model: any) => resolve({ index: EMPTY_INDEX, model }));
      }) as any);
    return pending;
  }

  function deferParses() {
    const pending = new Map<string, (model: any) => void>();
    mockParseDialogFile.mockImplementation((filePath: string) =>
      new Promise((resolve) => { pending.set(filePath, resolve); }) as any);
    return pending;
  }

  function switchToProjectB() {
    act(() => {
      useProjectStore.getState().closeProject();
      useProjectStore.setState({
        projectPath: PROJ_B,
        projectName: 'ProjectB',
        allDialogFiles: [FILE_B1],
        dialogIndex: new Map(),
      });
    });
  }

  test('a change batch parsing when the project switches is discarded', async () => {
    const pending = deferIndexes();
    const { unmount } = await setupHook();

    emit({ type: 'change', filePath: FILE_A });
    await act(async () => {
      await waitFor(() => expect(pending.has(FILE_A)).toBe(true), { timeout: 2000 });
    });

    switchToProjectB();
    await act(async () => {
      pending.get(FILE_A)!(modelFor(FILE_A));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const { parsedFiles, dialogIndex } = useProjectStore.getState();
    expect(parsedFiles.has(FILE_A)).toBe(false);
    expect(dialogIndex.size).toBe(0);
    unmount();
  });

  test('an old batch resolving after the new project\'s batch does not overwrite it', async () => {
    const pending = deferIndexes();
    const { unmount } = await setupHook();

    emit({ type: 'change', filePath: FILE_A });
    await act(async () => {
      await waitFor(() => expect(pending.has(FILE_A)).toBe(true), { timeout: 2000 });
    });

    switchToProjectB();
    await waitFor(() => expect(capturedOnFileChanged).not.toBeNull());
    emit({ type: 'change', filePath: FILE_B1 });
    await act(async () => {
      await waitFor(() => expect(pending.has(FILE_B1)).toBe(true), { timeout: 2000 });
      pending.get(FILE_B1)!(modelFor(FILE_B1));
      await waitFor(() => expect(useProjectStore.getState().parsedFiles.has(FILE_B1)).toBe(true));
    });
    const generationAfterB = useProjectStore.getState().parseGeneration;

    await act(async () => {
      pending.get(FILE_A)!(modelFor(FILE_A));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const { parsedFiles, parseGeneration, dialogIndex } = useProjectStore.getState();
    expect(parsedFiles.has(FILE_A)).toBe(false);
    expect(parseGeneration).toBe(generationAfterB);
    expect(Array.from(dialogIndex.values()).flat().map((d) => d.filePath)).not.toContain(FILE_A);
    unmount();
  });

  test('an added file parsing when the project switches is discarded', async () => {
    const FILE_NEW = 'C:/project/NPC_NEW.d';
    mockIndexFile.mockResolvedValue({ index: EMPTY_INDEX, model: EMPTY_MODEL as any });
    const writeFile = jest.spyOn(window.editorAPI, 'writeFile');
    writeFile.mockClear();
    const pending = deferParses();
    const { unmount } = await setupHook();

    emit({ type: 'add', filePath: FILE_NEW });
    await act(async () => {
      await waitFor(() => expect(pending.has(FILE_NEW)).toBe(true), { timeout: 2000 });
    });

    switchToProjectB();
    await act(async () => {
      pending.get(FILE_NEW)!({
        ...modelFor(FILE_NEW),
        dialogs: { DIA_NEW: { name: 'DIA_NEW', properties: { npc: 'NewNpc' } } },
        npcs: { NewNpc: { name: 'NewNpc' } },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const { parsedFiles, dialogIndex, allDialogFiles } = useProjectStore.getState();
    expect(parsedFiles.has(FILE_NEW)).toBe(false);
    expect(dialogIndex.size).toBe(0);
    expect(allDialogFiles).toEqual([FILE_B1]);
    expect(mockIndexFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    unmount();
  });
});
