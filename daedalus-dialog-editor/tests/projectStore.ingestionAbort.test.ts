import { useProjectStore } from '../src/renderer/store/projectStore';
import type { SemanticModel } from '../src/renderer/types/global';

const emptyModel = (): SemanticModel => ({
  dialogs: {},
  functions: {},
  constants: {},
  variables: {},
  instances: {},
  hasErrors: false,
  errors: []
});

describe('projectStore background ingestion abort guard', () => {
  const OLD_FILE = '/old/DIA_Old.d';
  let originalParse: unknown;

  beforeEach(() => {
    useProjectStore.getState().closeProject();
    originalParse = (window as never as { editorAPI: { parseDialogFile: unknown } }).editorAPI.parseDialogFile;
  });

  afterEach(() => {
    (window as never as { editorAPI: { parseDialogFile: unknown } }).editorAPI.parseDialogFile = originalParse;
  });

  test('aborted run finally-flush must not write into the successor project cache', async () => {
    // Deferred parse: the ingestion worker parks on this until we resolve it.
    let resolveParse: (m: SemanticModel) => void = () => {};
    const parseMock = jest.fn(
      () => new Promise<SemanticModel>((resolve) => { resolveParse = resolve; })
    );
    (window as never as { editorAPI: { parseDialogFile: unknown } }).editorAPI.parseDialogFile = parseMock;

    // Old project state.
    useProjectStore.setState({
      projectPath: '/old',
      allDialogFiles: [OLD_FILE],
      questFiles: [],
      parsedFiles: new Map(),
      abortIngestion: null
    } as never);

    const runPromise = useProjectStore.getState().startBackgroundIngestion();

    // The worker has requested the parse and is now awaiting it.
    expect(parseMock).toHaveBeenCalledTimes(1);

    // Simulate openProject switching to a new project: fresh cache + new path,
    // then abort the previous ingestion (mirrors startBackgroundIngestion's
    // cancel-previous behaviour).
    const abort = useProjectStore.getState().abortIngestion;
    useProjectStore.setState({ parsedFiles: new Map(), projectPath: '/new' } as never);
    abort?.();

    // Let the parked parse resolve; the aborted run's success path + finally
    // flush must both discard the stale entry.
    resolveParse(emptyModel());
    await runPromise;

    expect(useProjectStore.getState().parsedFiles.has(OLD_FILE)).toBe(false);
    expect(useProjectStore.getState().projectPath).toBe('/new');
  });
});
