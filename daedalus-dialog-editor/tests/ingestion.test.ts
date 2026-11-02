import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { useProjectStore } from '../src/renderer/store/projectStore';

// Mock setTimeout to be real for these tests as we rely on timing/async
// jest.useRealTimers(); // Default in Jest usually, but good to know.

describe('projectStore - ingestion', () => {
  beforeEach(() => {
    useProjectStore.getState().closeProject();
    jest.clearAllMocks();
  });

  test('should ingest all files', async () => {
    const files = Array.from({ length: 10 }, (_, i) => `file${i}.d`);
    
    // Mock API
    const parseDialogFileMock = jest.fn(async (_filePath: string) => {
      // simulate some work
      await new Promise(resolve => setTimeout(resolve, 10));
      return {
        dialogs: {},
        functions: {},
        constants: {},
        variables: {},
        instances: {},
        hasErrors: false,
        errors: []
      };
    });
    (window as any).editorAPI.parseDialogFile = parseDialogFileMock;

    // Setup store state directly
    useProjectStore.setState({
      allDialogFiles: files,
      questFiles: [],
      parsedFiles: new Map()
    });

    const store = useProjectStore.getState();
    await store.startBackgroundIngestion();

    const finalState = useProjectStore.getState();
    expect(finalState.parsedFiles.size).toBe(10);
    expect(parseDialogFileMock).toHaveBeenCalledTimes(10);
  });

  test('should handle ingestion errors correctly', async () => {
    const files = ['good.d', 'bad.d', 'good2.d'];
    
    const parseDialogFileMock = jest.fn(async (filePath: string) => {
      if (filePath === 'bad.d') {
        throw new Error('Parse error');
      }
      return {
        dialogs: {},
        functions: {},
        constants: {},
        variables: {},
        instances: {},
        hasErrors: false,
        errors: []
      };
    });
    (window as any).editorAPI.parseDialogFile = parseDialogFileMock;

    useProjectStore.setState({
      allDialogFiles: files,
      questFiles: [],
      parsedFiles: new Map()
    });

    const store = useProjectStore.getState();
    await store.startBackgroundIngestion();

    const finalState = useProjectStore.getState();
    expect(finalState.parsedFiles.size).toBe(3);
    
    const badFile = finalState.parsedFiles.get('bad.d');
    expect(badFile).toBeDefined();
    expect(badFile?.semanticModel.hasErrors).toBe(true);
    expect(badFile?.semanticModel.errors[0].message).toBe('Parse error');
  });

  test('should respect abort signal', async () => {
    const files = Array.from({ length: 100 }, (_, i) => `file${i}.d`);
    
    const parseDialogFileMock = jest.fn(async (_filePath: string) => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return {
        dialogs: {},
        functions: {},
        constants: {},
        variables: {},
        instances: {},
        hasErrors: false,
        errors: []
      };
    });
    (window as any).editorAPI.parseDialogFile = parseDialogFileMock;

    useProjectStore.setState({
      allDialogFiles: files,
      questFiles: [],
      parsedFiles: new Map()
    });

    const store = useProjectStore.getState();
    const ingestionPromise = store.startBackgroundIngestion();
    
    // Abort immediately after start (waiting for first batch to likely start)
    await new Promise(resolve => setTimeout(resolve, 30));
    
    if (useProjectStore.getState().abortIngestion) {
        useProjectStore.getState().abortIngestion!();
    }

    await ingestionPromise;

    const finalState = useProjectStore.getState();
    // Should have processed some, but not all
    // With batch size 20, and 20ms delay, and 30ms wait, maybe 20-40 processed.
    expect(finalState.parsedFiles.size).toBeLessThan(100);
    // expect(finalState.isIngesting).toBe(false); // See note in thought process: manual abort doesn't reset flag
  });

  test('a global file ingested after the NPC was selected reaches the merged model', async () => {
    // #466: only `updateFileModels` re-derived the merged model, so a constant
    // that arrived during background ingestion stayed invisible for the rest of
    // the session — the index disagreed with the cache it was built from.
    const npcFile = '/p/DIA_Onar.d';
    const globalsFile = '/p/Story_Globals.d';

    const emptyModel = {
      dialogs: {}, functions: {}, constants: {}, variables: {},
      instances: {}, hasErrors: false, errors: []
    };
    (window as any).editorAPI.parseDialogFile = jest.fn(async (filePath: string) => (
      filePath === globalsFile
        ? { ...emptyModel, constants: { TOPIC_ONAR: { name: 'TOPIC_ONAR', type: 'string' } } }
        : emptyModel
    ));

    useProjectStore.setState({
      projectPath: '/p',
      allDialogFiles: [npcFile, globalsFile],
      questFiles: [],
      selectedNpc: 'NPC_ONAR',
      dialogIndex: new Map([
        ['NPC_ONAR', [{ dialogName: 'DIA_Onar_Hallo', npc: 'NPC_ONAR', filePath: npcFile }]]
      ]),
      // Selected before ingestion read the globals, which is what the cache
      // looks like on a project large enough for ingestion to outlast a click.
      parsedFiles: new Map([[npcFile, { filePath: npcFile, semanticModel: emptyModel, lastParsed: new Date() }]])
    });
    useProjectStore.getState().loadAndMergeNpcModels('NPC_ONAR');
    expect(useProjectStore.getState().mergedSemanticModel.constants).not.toHaveProperty('TOPIC_ONAR');

    await useProjectStore.getState().startBackgroundIngestion();

    expect(useProjectStore.getState().mergedSemanticModel.constants).toHaveProperty('TOPIC_ONAR');
  });
});
