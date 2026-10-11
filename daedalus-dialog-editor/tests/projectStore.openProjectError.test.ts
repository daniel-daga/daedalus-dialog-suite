import { useProjectStore } from '../src/renderer/store/projectStore';

type IndexMockable = { editorAPI: { buildProjectIndex: unknown; loadProjectConfig: unknown } };

/**
 * 2026-07 finding 2.1: `openProject` caught every failure into `loadError` —
 * a field no component reads — and never rethrew, so `App`'s own catch around
 * `openProject` could not fire and the user stayed on the welcome screen with
 * no message at all.
 */
describe('projectStore openProject error propagation (2.1)', () => {
  let original: unknown;
  let originalConfigLoader: unknown;

  beforeEach(() => {
    useProjectStore.getState().closeProject();
    original = (window as never as IndexMockable).editorAPI.buildProjectIndex;
    originalConfigLoader = (window as never as IndexMockable).editorAPI.loadProjectConfig;
  });

  afterEach(() => {
    (window as never as IndexMockable).editorAPI.buildProjectIndex = original;
    (window as never as IndexMockable).editorAPI.loadProjectConfig = originalConfigLoader;
  });

  test('openProject rethrows when the index build fails', async () => {
    (window as never as IndexMockable).editorAPI.buildProjectIndex = jest.fn(
      () => Promise.reject(new Error('index build exploded'))
    );
    (window as never as IndexMockable).editorAPI.loadProjectConfig = jest.fn(() => Promise.resolve({
      projectFilePath: '/proj/demo.gothicproject.json', projectRoot: '/proj', scriptsRoot: '/proj',
      config: { version: 1, target: 'g2-notr', scriptsRoot: '.', worlds: [], assetSources: ['.'] },
      resolvedAssetSources: ['/proj'], warnings: []
    }));

    await expect(useProjectStore.getState().openProject('/proj')).rejects.toThrow(
      'index build exploded'
    );
  });

  test('a failed open still clears isLoading and records the message', async () => {
    (window as never as IndexMockable).editorAPI.buildProjectIndex = jest.fn(
      () => Promise.reject(new Error('index build exploded'))
    );
    (window as never as IndexMockable).editorAPI.loadProjectConfig = jest.fn(() => Promise.resolve({
      projectFilePath: '/proj/demo.gothicproject.json', projectRoot: '/proj', scriptsRoot: '/proj',
      config: { version: 1, target: 'g2-notr', scriptsRoot: '.', worlds: [], assetSources: ['.'] },
      resolvedAssetSources: ['/proj'], warnings: []
    }));

    await expect(useProjectStore.getState().openProject('/proj')).rejects.toThrow();

    expect(useProjectStore.getState().isLoading).toBe(false);
    expect(useProjectStore.getState().loadError).toBe('index build exploded');
  });

  test('config loading failure prevents indexing', async () => {
    const buildIndex = jest.fn();
    (window as never as IndexMockable).editorAPI.buildProjectIndex = buildIndex;
    (window as never as IndexMockable).editorAPI.loadProjectConfig = jest.fn(
      () => Promise.reject(new Error('config invalid'))
    );

    await expect(useProjectStore.getState().openProject('/proj')).rejects.toThrow('config invalid');
    expect(buildIndex).not.toHaveBeenCalled();
  });
});
