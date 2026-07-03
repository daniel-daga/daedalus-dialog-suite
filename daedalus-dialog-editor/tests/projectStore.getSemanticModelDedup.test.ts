import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/renderer/types/global';

const model = (marker: string): SemanticModel => ({
  dialogs: {},
  functions: {},
  constants: {},
  variables: { [marker]: { name: marker, type: 'int' } } as never,
  instances: {},
  hasErrors: false,
  errors: []
});

type ParseMockable = { editorAPI: { parseDialogFile: unknown; readFile: unknown; writeFile: unknown } };

describe('projectStore getSemanticModel in-flight dedup (PF5b)', () => {
  const FILE = '/proj/DIA_Some.d';
  let original: { parseDialogFile: unknown; readFile: unknown; writeFile: unknown };

  beforeEach(() => {
    useProjectStore.getState().closeProject();
    const api = (window as never as ParseMockable).editorAPI;
    original = { parseDialogFile: api.parseDialogFile, readFile: api.readFile, writeFile: api.writeFile };
  });

  afterEach(() => {
    const api = (window as never as ParseMockable).editorAPI;
    api.parseDialogFile = original.parseDialogFile;
    api.readFile = original.readFile;
    api.writeFile = original.writeFile;
  });

  test('two synchronous calls trigger a single parse and share the same model', async () => {
    let resolveParse: (m: SemanticModel) => void = () => {};
    const parseMock = jest.fn(() => new Promise<SemanticModel>((r) => { resolveParse = r; }));
    (window as never as ParseMockable).editorAPI.parseDialogFile = parseMock;

    const store = useProjectStore.getState();
    const p1 = store.getSemanticModel(FILE);
    const p2 = store.getSemanticModel(FILE);

    expect(parseMock).toHaveBeenCalledTimes(1);

    resolveParse(model('SHARED'));
    const [m1, m2] = await Promise.all([p1, p2]);
    expect(m1).toBe(m2);
  });

  test('clearCache drops an in-flight parse so the next call re-parses', async () => {
    let resolveFirst: (m: SemanticModel) => void = () => {};
    const parseMock = jest
      .fn()
      .mockImplementationOnce(() => new Promise<SemanticModel>((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(model('SECOND'));
    (window as never as ParseMockable).editorAPI.parseDialogFile = parseMock as never;

    const store = useProjectStore.getState();
    const p1 = store.getSemanticModel(FILE); // parse #1 in flight
    useProjectStore.getState().clearCache(); // must drop the in-flight entry
    const p2 = store.getSemanticModel(FILE); // must start parse #2

    expect(parseMock).toHaveBeenCalledTimes(2);

    resolveFirst(model('FIRST'));
    const second = await p2;
    await p1;
    expect(second.variables).toHaveProperty('SECOND');
  });

  test('closeProject drops an in-flight parse so the next call re-parses', async () => {
    const parseMock = jest
      .fn()
      .mockImplementationOnce(() => new Promise<SemanticModel>(() => {})) // never resolves
      .mockResolvedValueOnce(model('AFTER_CLOSE'));
    (window as never as ParseMockable).editorAPI.parseDialogFile = parseMock as never;

    const store = useProjectStore.getState();
    store.getSemanticModel(FILE); // parse #1 in flight
    useProjectStore.getState().closeProject(); // must drop the in-flight entry
    await useProjectStore.getState().getSemanticModel(FILE); // must start parse #2

    expect(parseMock).toHaveBeenCalledTimes(2);
  });

  test('invalidateCacheForFile (via mutateQuestFile) drops the in-flight parse so post-write reads are fresh', async () => {
    const api = (window as never as ParseMockable).editorAPI;
    api.readFile = jest.fn(async () => 'var int V_OLD;\n');
    api.writeFile = jest.fn(async () => ({ success: true }));

    const parseMock = jest
      .fn()
      .mockImplementationOnce(() => new Promise<SemanticModel>(() => {})) // stale, in flight
      .mockResolvedValueOnce(model('V_FRESH')); // post-write re-parse
    api.parseDialogFile = parseMock as never;

    const questFile = '/proj/Quests.d';
    useProjectStore.setState({
      allDialogFiles: [questFile],
      questFiles: [questFile],
      parsedFiles: new Map(),
      mergedSemanticModel: model('V_OLD')
    } as never);

    const store = useProjectStore.getState();
    store.getSemanticModel(questFile); // stale parse in flight

    await store.deleteVariable(questFile, { startIndex: 0, endIndex: 'var int V_OLD;'.length });

    // The mutation must NOT have received the pre-write parse: a fresh parse was
    // triggered after invalidation.
    expect(parseMock).toHaveBeenCalledTimes(2);
    const merged = useProjectStore.getState().mergedSemanticModel;
    expect(merged.variables).toHaveProperty('V_FRESH');
  });
});
