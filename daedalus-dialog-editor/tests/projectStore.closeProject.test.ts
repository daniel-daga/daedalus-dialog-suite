import { useProjectStore } from '../src/renderer/store/projectStore';

/**
 * closeProject must reset every piece of project state that App/MainLayout
 * read, so the welcome screen renders cleanly and a subsequently opened
 * project cannot inherit stale index data (notably questFiles, which the
 * quest editor's loadQuestData iterates).
 */
describe('ProjectStore - closeProject', () => {
  test('clears project state including questFiles', () => {
    useProjectStore.setState({
      projectPath: '/some/project',
      projectFilePath: '/some/project/project.gothicproject.json',
      projectConfig: { version: 1, target: 'g2-notr', scriptsRoot: '.', worlds: [], assetSources: ['.'] },
      resolvedAssetSources: ['/some/project'],
      projectWarnings: [{ code: 'asset-source-unavailable', source: '/missing', resolvedPath: '/missing', message: 'missing' }],
      projectName: 'project',
      npcList: ['NPC_1'],
      routineList: ['Routine_1'],
      dialogIndex: new Map([['NPC_1', [{ dialogName: 'DIA_X', npc: 'NPC_1', filePath: '/some/project/x.d' }]]]),
      allDialogFiles: ['/some/project/x.d'],
      questFiles: ['/some/project/Topics.d'],
      npcPrototypes: ['NPC_DEFAULT'],
      voiceIdIndex: { X: [{ filePath: '/some/project/x.d', functionName: 'f' }] },
      spawnSiteIndex: [{ instance: 'GRD_200', spawnPoint: 'WP', filePath: '/some/project/x.d', functionName: 'f', line: 3 }],
      metadataFailures: [{ filePath: '/some/project/bad.d', error: 'boom' }],
      selectedNpc: 'NPC_1',
      loadError: 'old error',
    });

    useProjectStore.getState().closeProject();

    const state = useProjectStore.getState();
    expect(state.projectPath).toBeNull();
    expect(state.projectFilePath).toBeNull();
    expect(state.projectConfig).toBeNull();
    expect(state.resolvedAssetSources).toEqual([]);
    expect(state.projectWarnings).toEqual([]);
    expect(state.projectName).toBeNull();
    expect(state.npcList).toEqual([]);
    expect(state.routineList).toEqual([]);
    expect(state.dialogIndex.size).toBe(0);
    expect(state.allDialogFiles).toEqual([]);
    expect(state.questFiles).toEqual([]);
    expect(state.npcPrototypes).toEqual([]);
    expect(state.voiceIdIndex).toEqual({});
    expect(state.spawnSiteIndex).toEqual([]);
    expect(state.metadataFailures).toEqual([]);
    expect(state.parsedFiles.size).toBe(0);
    expect(state.selectedNpc).toBeNull();
    expect(state.loadError).toBeNull();
  });
});
