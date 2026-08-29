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

type ParseMockable = { editorAPI: { parseDialogFile: unknown } };

/**
 * 2026-07 finding 4.1: `getSemanticModel` writes its result into `parsedFiles`
 * after the await with no staleness guard, so a parse that was invalidated
 * mid-flight still lands and overwrites whatever replaced it.
 */
describe('projectStore getSemanticModel stale cache write (4.1)', () => {
  const FILE = '/proj/DIA_Some.d';
  let original: unknown;

  beforeEach(() => {
    useProjectStore.getState().closeProject();
    original = (window as never as ParseMockable).editorAPI.parseDialogFile;
  });

  afterEach(() => {
    (window as never as ParseMockable).editorAPI.parseDialogFile = original;
  });

  const startParse = () => {
    let resolveParse: (m: SemanticModel) => void = () => {};
    (window as never as ParseMockable).editorAPI.parseDialogFile = jest.fn(
      () => new Promise<SemanticModel>((r) => { resolveParse = r; })
    );
    const promise = useProjectStore.getState().getSemanticModel(FILE);
    return { promise, resolve: (m: SemanticModel) => resolveParse(m) };
  };

  test('a parse invalidated by clearCache does not land in the cache', async () => {
    const parse = startParse();

    useProjectStore.getState().clearCache();
    parse.resolve(model('STALE'));
    await parse.promise;

    expect(useProjectStore.getState().parsedFiles.has(FILE)).toBe(false);
  });

  test('a parse resolving after an editor push does not overwrite the open model', async () => {
    const parse = startParse();

    // storeSync pushes the open file's model while the disk parse is in flight.
    useProjectStore.getState().updateFileModel(FILE, model('FROM_EDITOR'));
    parse.resolve(model('STALE'));
    await parse.promise;

    const cached = useProjectStore.getState().parsedFiles.get(FILE);
    expect(cached?.semanticModel.variables).toHaveProperty('FROM_EDITOR');
    expect(cached?.semanticModel.variables).not.toHaveProperty('STALE');
  });

  test('a parse resolving after closeProject does not repopulate the cache', async () => {
    const parse = startParse();

    useProjectStore.getState().closeProject();
    parse.resolve(model('STALE'));
    await parse.promise;

    expect(useProjectStore.getState().parsedFiles.size).toBe(0);
  });

  test('the caller still receives the model it asked for', async () => {
    const parse = startParse();

    useProjectStore.getState().clearCache();
    parse.resolve(model('STALE'));

    await expect(parse.promise).resolves.toHaveProperty('variables.STALE');
  });

  test('an uninvalidated parse still caches', async () => {
    const parse = startParse();

    parse.resolve(model('FRESH'));
    await parse.promise;

    expect(useProjectStore.getState().parsedFiles.get(FILE)?.semanticModel.variables)
      .toHaveProperty('FRESH');
  });
});
