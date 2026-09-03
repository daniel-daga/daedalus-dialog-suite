import { useProjectStore } from '../src/renderer/store/projectStore';

const descriptor = {
  projectFilePath: '/proj/demo.gothicproject.json',
  projectRoot: '/proj',
  scriptsRoot: '/proj/scripts',
  config: { version: 1 as const, target: 'g2-notr' as const, scriptsRoot: 'scripts', worlds: [], assetSources: ['.', 'C:/Gothic'] },
  resolvedAssetSources: ['/proj', 'C:/Gothic/Data'],
  warnings: [{ code: 'asset-source-unavailable' as const, source: 'C:/Missing', resolvedPath: 'C:/Missing', message: 'missing' }]
};

const index = {
  npcs: [], routines: [], dialogsByNpc: {}, allFiles: [], questFiles: [], npcPrototypes: [],
  voiceIds: {}, waypointSites: {}, spawnSites: [], routineSites: [], routinesByNpc: {},
  routineStatesByNpc: {}, metadataFailures: []
};

describe('ProjectStore - project asset sources', () => {
  let originalLoad: unknown;
  let originalIndex: unknown;
  let originalSave: unknown;

  beforeEach(() => {
    useProjectStore.getState().closeProject();
    originalLoad = window.editorAPI.loadProjectConfig;
    originalIndex = window.editorAPI.buildProjectIndex;
    originalSave = window.editorAPI.saveProjectAssetSources;
  });

  afterEach(() => {
    window.editorAPI.loadProjectConfig = originalLoad as typeof window.editorAPI.loadProjectConfig;
    window.editorAPI.buildProjectIndex = originalIndex as typeof window.editorAPI.buildProjectIndex;
    window.editorAPI.saveProjectAssetSources = originalSave as typeof window.editorAPI.saveProjectAssetSources;
  });

  test('loads config before indexing scriptsRoot and stores normalized descriptor', async () => {
    const loadConfig = jest.fn(async () => descriptor);
    const buildIndex = jest.fn(async (root: string) => {
      expect(root).toBe('/proj/scripts');
      return index;
    });
    window.editorAPI.loadProjectConfig = loadConfig;
    window.editorAPI.buildProjectIndex = buildIndex;

    await useProjectStore.getState().openProject('/proj');

    expect(loadConfig.mock.invocationCallOrder[0]).toBeLessThan(buildIndex.mock.invocationCallOrder[0]);
    expect(useProjectStore.getState()).toMatchObject({
      projectPath: '/proj',
      scriptsRoot: descriptor.scriptsRoot,
      projectFilePath: descriptor.projectFilePath,
      projectConfig: descriptor.config,
      resolvedAssetSources: descriptor.resolvedAssetSources,
      projectWarnings: descriptor.warnings
    });
  });

  test('saveAssetSources replaces config and warnings with IPC response', async () => {
    useProjectStore.setState({ projectFilePath: descriptor.projectFilePath });
    const saved = { ...descriptor, config: { ...descriptor.config, assetSources: ['.', 'assets'] }, resolvedAssetSources: ['/proj', '/proj/assets'], warnings: [] };
    const save = jest.fn(async () => saved);
    window.editorAPI.saveProjectAssetSources = save;

    await useProjectStore.getState().saveAssetSources(['.', 'assets']);

    expect(save).toHaveBeenCalledWith(descriptor.projectFilePath, ['.', 'assets'], undefined);
    expect(useProjectStore.getState().projectConfig).toEqual(saved.config);
    expect(useProjectStore.getState().resolvedAssetSources).toEqual(saved.resolvedAssetSources);
    expect(useProjectStore.getState().projectWarnings).toEqual([]);
  });

  test('saveAssetSources passes the GMBT project folder straight through', async () => {
    useProjectStore.setState({ projectFilePath: descriptor.projectFilePath });
    const saved = { ...descriptor, gmbtProjectDir: '/proj/gmbt', warnings: [] };
    const save = jest.fn(async () => saved);
    window.editorAPI.saveProjectAssetSources = save;

    await useProjectStore.getState().saveAssetSources(['.'], 'gmbt');

    expect(save).toHaveBeenCalledWith(descriptor.projectFilePath, ['.'], 'gmbt');
    expect(useProjectStore.getState().gmbtProjectDir).toBe('/proj/gmbt');
  });

  test('dismissProjectWarning removes only matching resolved path', () => {
    useProjectStore.setState({ projectWarnings: descriptor.warnings });

    useProjectStore.getState().dismissProjectWarning('C:/Missing');

    expect(useProjectStore.getState().projectWarnings).toEqual([]);
  });

  test('does not apply an in-flight save after the project is closed', async () => {
    useProjectStore.setState({
      projectPath: descriptor.projectRoot,
      projectFilePath: descriptor.projectFilePath,
      projectConfig: descriptor.config,
      projectWarnings: descriptor.warnings
    });
    let resolveSave: (value: typeof descriptor) => void = () => {};
    window.editorAPI.saveProjectAssetSources = jest.fn(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));

    const savePromise = useProjectStore.getState().saveAssetSources(['.', 'assets']);
    useProjectStore.getState().closeProject();
    resolveSave(descriptor);
    await savePromise;

    expect(useProjectStore.getState().projectFilePath).toBeNull();
    expect(useProjectStore.getState().projectConfig).toBeNull();
    expect(useProjectStore.getState().projectWarnings).toEqual([]);
  });
});
