import { useProjectStore } from '../src/renderer/store/projectStore';
import type { ProjectIndex, SemanticModel } from '../src/shared/types';

// #568: main decides which scripts the SRC lists compile. The store obeys that
// answer when one file is re-read, and takes the whole index again when a list
// changes.

const model = (name: string): SemanticModel => ({
  dialogs: {}, functions: { [name]: { name } }, constants: {}, variables: {}, instances: {},
  hasErrors: false, errors: [],
} as unknown as SemanticModel);

const projectIndex = (allFiles: string[], npcFiles: Record<string, string>): ProjectIndex => ({
  npcs: Object.keys(npcFiles), dialogsByNpc: {}, allFiles, questFiles: [], routines: [], functions: [],
  npcPrototypes: [], npcCoverage: { npcInstancesFound: 0, missingPrototypes: [] }, npcFiles, instanceFiles: {},
  voiceIds: {}, waypointSites: {}, spawnSites: [], routineSites: [], routinesByNpc: {}, routineStatesByNpc: {},
  npcIds: {}, routineLayouts: {}, exchangeSites: [], metadataFailures: [], parseErrors: [],
} as unknown as ProjectIndex);

describe('ProjectStore - SRC membership (#568)', () => {
  const originals = { ...window.editorAPI };
  const cached = (filePath: string) => [filePath, { filePath, semanticModel: model(filePath), lastParsed: new Date() }] as const;

  beforeEach(() => {
    useProjectStore.setState({
      projectPath: '/p', scriptsRoot: '/p/Scripts', selectedNpc: null,
      allDialogFiles: ['/p/Live.d', '/p/Stub.d'], questFiles: [],
      npcList: ['STUB'], npcFileIndex: { STUB: '/p/Stub.d' }, instanceFileIndex: { STUB: '/p/Stub.d' },
      npcIdIndex: {}, routineNpcIndex: {}, routineStateIndex: {}, routineLayoutIndex: {},
      routineSiteIndex: [], spawnSiteIndex: [], exchangeSiteIndex: [], dialogIndex: new Map(),
      parsedFiles: new Map([cached('/p/Live.d'), cached('/p/Stub.d'), cached('/elsewhere/Opened.d')]),
    });
  });
  afterEach(() => {
    useProjectStore.getState().abortIngestion?.();
    Object.assign(window.editorAPI, originals);
  });

  it('gives an excluded file no model and drops any share of the index it held', async () => {
    window.editorAPI.indexFile = jest.fn(async () => ({ excluded: true as const }));
    const models = await useProjectStore.getState().reindexFiles(['/p/Stub.d']);
    expect(models.size).toBe(0);
    expect(useProjectStore.getState().npcFileIndex).toEqual({});
  });

  it('takes the whole index again and forgets the models of files that left it', async () => {
    const build = jest.fn(async () => projectIndex(['/p/Live.d', '/p/New.d'], { NEW: '/p/New.d' }));
    const parse = jest.fn(async (filePath: string) => model(filePath));
    window.editorAPI.buildProjectIndex = build;
    window.editorAPI.parseDialogFile = parse as unknown as typeof window.editorAPI.parseDialogFile;

    await useProjectStore.getState().refreshProjectIndex();
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(build).toHaveBeenCalledWith('/p/Scripts');
    const state = useProjectStore.getState();
    expect(state.allDialogFiles).toEqual(['/p/Live.d', '/p/New.d']);
    expect(state.npcFileIndex).toEqual({ NEW: '/p/New.d' });
    // The excluded file's model is gone; a newly included file is ingested; a
    // file opened from outside the index keeps its model.
    expect([...state.parsedFiles.keys()].sort()).toEqual(['/elsewhere/Opened.d', '/p/Live.d', '/p/New.d']);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledWith('/p/New.d');
  });

  it('drops a refresh that finishes after the project was closed', async () => {
    let finish: (index: ProjectIndex) => void = () => undefined;
    window.editorAPI.buildProjectIndex = jest.fn(() => new Promise<ProjectIndex>((resolve) => { finish = resolve; }));
    const pending = useProjectStore.getState().refreshProjectIndex();
    useProjectStore.getState().closeProject();
    finish(projectIndex(['/p/Live.d'], {}));
    await pending;
    expect(useProjectStore.getState().allDialogFiles).toEqual([]);
  });
});
