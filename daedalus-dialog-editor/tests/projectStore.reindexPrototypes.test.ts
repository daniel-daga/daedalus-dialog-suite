import { useProjectStore } from '../src/renderer/store/projectStore';
import type { FileIndex, ProjectIndex, SemanticModel } from '../src/shared/types';

// #469: a file whose instances inherit through a prototype it declares changes
// the project's inheritance for every file, and only the load's own chain rule
// (ProjectService's `chainEnd`) can say whether those instances are NPCs. So
// such a file takes the whole index again instead of the narrower incremental
// rule — and a file that declares no prototype must not, or every plain NPC
// edit would re-index the project.

const fileIndex = (index: Partial<FileIndex>): FileIndex => ({
  routineSites: [], spawnSites: [], exchangeSites: [], instances: [], ...index,
});

const projectIndex = (
  npcs: string[],
  npcFiles: Record<string, string>,
  npcPrototypes: string[]
): ProjectIndex => ({
  npcs,
  dialogsByNpc: {},
  allFiles: ['/p/Onar.d', '/p/SLD.d'],
  questFiles: [],
  routines: [],
  functions: [],
  npcPrototypes,
  npcCoverage: { npcInstancesFound: npcs.length, missingPrototypes: [] },
  npcFiles,
  voiceIds: {},
  waypointSites: {},
  spawnSites: [],
  routineSites: [],
  routinesByNpc: {},
  routineStatesByNpc: {},
  npcIds: {},
  routineLayouts: {},
  exchangeSites: [],
  metadataFailures: [],
  parseErrors: [],
} as unknown as ProjectIndex);

describe('ProjectStore - reindexFiles and prototypes', () => {
  let originalIndexFile: unknown;
  let originalBuild: unknown;

  beforeEach(() => {
    originalIndexFile = window.editorAPI.indexFile;
    originalBuild = window.editorAPI.buildProjectIndex;
    useProjectStore.setState({
      projectPath: '/p',
      scriptsRoot: '/p/Scripts',
      npcList: ['BAU_900_Onar'],
      npcPrototypes: ['NPC_DEFAULT'],
      npcFileIndex: { BAU_900_ONAR: '/p/Onar.d' },
      npcIdIndex: { BAU_900_ONAR: 900 },
      routineNpcIndex: {},
      routineStateIndex: {},
      routineLayoutIndex: {},
      routineSiteIndex: [],
      spawnSiteIndex: [],
      exchangeSiteIndex: [],
    });
  });

  afterEach(() => {
    window.editorAPI.indexFile = originalIndexFile as typeof window.editorAPI.indexFile;
    window.editorAPI.buildProjectIndex = originalBuild as typeof window.editorAPI.buildProjectIndex;
  });

  const rebuilds = (): jest.Mock => {
    const build = jest.fn(async () => projectIndex(
      ['BAU_900_Onar', 'SLD_Foo'],
      { BAU_900_ONAR: '/p/Onar.d', SLD_FOO: '/p/SLD.d' },
      ['NPC_DEFAULT', 'SLD_NEW']
    ));
    window.editorAPI.buildProjectIndex = build;
    return build;
  };

  it("takes the whole index again for a file that declares a prototype, so the NPCs inheriting through it are listed", async () => {
    window.editorAPI.indexFile = jest.fn(async () => ({
      index: fileIndex({
        declaresPrototype: true,
        instances: [{ name: 'SLD_Foo', parent: 'SLD_New' }],
      }),
      model: {} as SemanticModel,
    }));
    const build = rebuilds();

    await useProjectStore.getState().reindexFiles(['/p/SLD.d']);

    expect(build).toHaveBeenCalledWith('/p/Scripts');
    const state = useProjectStore.getState();
    expect(state.npcList).toEqual(['BAU_900_Onar', 'SLD_Foo']);
    expect(state.npcFileIndex).toEqual({ BAU_900_ONAR: '/p/Onar.d', SLD_FOO: '/p/SLD.d' });
    expect(state.npcPrototypes).toContain('SLD_NEW');
  });

  it('keeps an ordinary NPC edit incremental, with no project-wide rebuild', async () => {
    window.editorAPI.indexFile = jest.fn(async () => ({
      index: fileIndex({
        instances: [{ name: 'BAU_903_Milten', parent: 'Npc_Default', npcId: 903 }],
      }),
      model: {} as SemanticModel,
    }));
    const build = rebuilds();

    await useProjectStore.getState().reindexFiles(['/p/Milten.d']);

    expect(build).not.toHaveBeenCalled();
    const state = useProjectStore.getState();
    expect(state.npcList).toEqual(['BAU_900_Onar', 'BAU_903_Milten']);
    expect(state.npcFileIndex).toEqual({ BAU_900_ONAR: '/p/Onar.d', BAU_903_MILTEN: '/p/Milten.d' });
  });

  it('drops a rebuild that lands after the project changed', async () => {
    window.editorAPI.indexFile = jest.fn(async () => ({
      index: fileIndex({
        declaresPrototype: true,
        instances: [{ name: 'SLD_Foo', parent: 'SLD_New' }],
      }),
      model: {} as SemanticModel,
    }));
    let release!: () => void;
    const rebuilt = new Promise<ProjectIndex>((resolve) => {
      release = () => resolve(projectIndex(['SLD_Foo'], { SLD_FOO: '/p/SLD.d' }, ['SLD_NEW']));
    });
    const build = jest.fn(() => rebuilt);
    window.editorAPI.buildProjectIndex = build;

    const pending = useProjectStore.getState().reindexFiles(['/p/SLD.d']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(build).toHaveBeenCalled();
    useProjectStore.setState({ projectPath: '/q' });
    release();
    await pending;

    expect(useProjectStore.getState().npcList).toEqual(['BAU_900_Onar']);
  });
});
