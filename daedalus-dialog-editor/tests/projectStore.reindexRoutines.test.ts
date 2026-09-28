import { useProjectStore } from '../src/renderer/store/projectStore';
import type { ExchangeSite, FileIndex, RoutineSite, SpawnSite } from '../src/shared/types';

// A routine save (npc-editor.md §6) and a script changed outside the editor
// (#319) read the file's share of the index again in main and replace that
// file's entries — otherwise the routine editor, the World surface's spawn and
// time layers and the Problems rules show the project as it was when it opened.

const site = (routine: string, filePath: string, startMinute: number): RoutineSite => ({
  routine, stateName: 'TA_SIT', startMinute, endMinute: startMinute + 60, waypoint: 'WP', filePath, line: 3,
});
const spawn = (instance: string, filePath: string): SpawnSite => ({
  instance, spawnPoint: 'WP', filePath, functionName: 'STARTUP', line: 1,
});
const exchange = (state: string, filePath: string): ExchangeSite => ({
  target: 'BAU_900_ONAR', state, filePath, functionName: 'B_KAPITEL3', line: 1,
});
const fileIndex = (index: Partial<FileIndex>): FileIndex => ({
  routineSites: [], spawnSites: [], exchangeSites: [], instances: [], ...index,
});

describe('ProjectStore - reindexFiles', () => {
  let original: unknown;
  beforeEach(() => {
    original = window.editorAPI.indexFile;
    useProjectStore.setState({
      npcList: ['BAU_900_Onar'],
      npcPrototypes: ['NPC_DEFAULT'],
      npcFileIndex: { BAU_900_ONAR: '/p/Onar.d' },
      npcIdIndex: { BAU_900_ONAR: 900 },
      routineNpcIndex: { BAU_900_ONAR: 'RTN_START_900' },
      routineStateIndex: {},
      routineLayoutIndex: {},
      routineSiteIndex: [site('RTN_START_900', '/p/Onar.d', 60)],
      spawnSiteIndex: [spawn('BAU_900_ONAR', '/p/Startup.d')],
      exchangeSiteIndex: [],
    });
  });
  afterEach(() => {
    window.editorAPI.indexFile = original as typeof window.editorAPI.indexFile;
  });

  const reads = (byFile: Record<string, FileIndex>) => {
    const read = jest.fn(async (filePath: string) => {
      if (!byFile[filePath]) throw new Error(`no ${filePath}`);
      return byFile[filePath];
    });
    window.editorAPI.indexFile = read;
    return read;
  };

  it("replaces each file's sites with what main reads, with the project's layouts, and keeps every other file's", async () => {
    const layouts = { TA_SIT: { startH: 0, startM: 1, stopH: 2, stopM: 3, waypoint: 4 } };
    useProjectStore.setState({
      routineLayoutIndex: layouts,
      routineSiteIndex: [site('RTN_A', '/p/A.d', 60), site('RTN_B', '/p/B.d', 120), site('RTN_A', '/p/A.d', 180)],
      spawnSiteIndex: [spawn('A', '/p/A.d'), spawn('B', '/p/B.d')],
      exchangeSiteIndex: [exchange('TOT', '/p/A.d'), exchange('SHIP', '/p/B.d')],
    });
    const read = reads({
      '/p/A.d': fileIndex({
        routineSites: [site('RTN_A', '/p/A.d', 600)],
        spawnSites: [spawn('A2', '/p/A.d')],
        exchangeSites: [exchange('KAPITEL3', '/p/A.d')],
      }),
    });

    await useProjectStore.getState().reindexFiles(['/p/A.d']);

    expect(read).toHaveBeenCalledWith('/p/A.d', layouts);
    const state = useProjectStore.getState();
    expect(state.routineSiteIndex).toEqual([site('RTN_B', '/p/B.d', 120), site('RTN_A', '/p/A.d', 600)]);
    expect(state.spawnSiteIndex).toEqual([spawn('B', '/p/B.d'), spawn('A2', '/p/A.d')]);
    expect(state.exchangeSiteIndex).toEqual([exchange('SHIP', '/p/B.d'), exchange('KAPITEL3', '/p/A.d')]);
  });

  it('re-reads the NPCs a file declares: a new one is listed, a removed one is forgotten, an item is not an NPC', async () => {
    reads({
      '/p/Onar.d': fileIndex({
        instances: [
          { name: 'BAU_901_Bauer', parent: 'Npc_Default', npcId: 901, dailyRoutine: 'Rtn_Start_901' },
          { name: 'ItMi_Gold', parent: 'C_Item', npcId: 5 },
        ],
      }),
    });

    await useProjectStore.getState().reindexFiles(['/p/Onar.d']);

    const state = useProjectStore.getState();
    expect(state.npcFileIndex).toEqual({ BAU_901_BAUER: '/p/Onar.d' });
    expect(state.npcIdIndex).toEqual({ BAU_901_BAUER: 901 });
    expect(state.routineNpcIndex).toEqual({ BAU_901_BAUER: 'RTN_START_901' });
    expect(state.npcList).toEqual(['BAU_900_Onar', 'BAU_901_Bauer']);
  });

  it("changes an NPC's daily routine when his file does", async () => {
    reads({
      '/p/Onar.d': fileIndex({
        instances: [{ name: 'BAU_900_Onar', parent: 'Npc_Default', npcId: 900, dailyRoutine: 'Rtn_Farm_900' }],
      }),
    });

    await useProjectStore.getState().reindexFiles(['/p/Onar.d']);

    expect(useProjectStore.getState().routineNpcIndex).toEqual({ BAU_900_ONAR: 'RTN_FARM_900' });
  });

  // The variant's file is not the NPC's, so the id has to come from the index
  // and the other routines from every file — the part that cannot be derived
  // from the changed file alone.
  it("derives a variant written in another file than the NPC's, by the id the NPC's file declared", async () => {
    reads({ '/p/Kapitel3.d': fileIndex({ routineSites: [site('RTN_KAPITEL3_900', '/p/Kapitel3.d', 60)] }) });

    await useProjectStore.getState().reindexFiles(['/p/Kapitel3.d']);

    expect(useProjectStore.getState().routineStateIndex).toEqual({
      BAU_900_ONAR: { id: 900, states: { KAPITEL3: 'RTN_KAPITEL3_900' } },
    });
  });

  it('forgets a variant whose routine left the file', async () => {
    useProjectStore.setState({
      routineSiteIndex: [site('RTN_START_900', '/p/Onar.d', 60), site('RTN_TOT_900', '/p/Onar.d', 0)],
      routineStateIndex: { BAU_900_ONAR: { id: 900, states: { TOT: 'RTN_TOT_900' } } },
    });
    reads({
      '/p/Onar.d': fileIndex({
        routineSites: [site('RTN_START_900', '/p/Onar.d', 60)],
        instances: [{ name: 'BAU_900_Onar', parent: 'Npc_Default', npcId: 900, dailyRoutine: 'Rtn_Start_900' }],
      }),
    });

    await useProjectStore.getState().reindexFiles(['/p/Onar.d']);

    expect(useProjectStore.getState().routineStateIndex).toEqual({});
  });

  it('drops a read that lands after the project changed', async () => {
    useProjectStore.setState({ projectPath: '/p' });
    let release!: () => void;
    window.editorAPI.indexFile = jest.fn(() => new Promise<FileIndex>((resolve) => {
      release = () => resolve(fileIndex({ routineSites: [site('RTN_OLD', '/p/Old.d', 0)] }));
    }));

    const pending = useProjectStore.getState().reindexFiles(['/p/Old.d']);
    useProjectStore.setState({ projectPath: '/q', routineSiteIndex: [] });
    release();
    await pending;

    expect(useProjectStore.getState().routineSiteIndex).toEqual([]);
  });

  it('keeps what it had for a file main could not read, and indexes the rest of the batch', async () => {
    reads({ '/p/Kapitel3.d': fileIndex({ routineSites: [site('RTN_KAPITEL3_900', '/p/Kapitel3.d', 60)] }) });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    await useProjectStore.getState().reindexFiles(['/p/Onar.d', '/p/Kapitel3.d']);

    const state = useProjectStore.getState();
    expect(state.npcFileIndex).toEqual({ BAU_900_ONAR: '/p/Onar.d' });
    expect(state.routineSiteIndex).toEqual([
      site('RTN_START_900', '/p/Onar.d', 60),
      site('RTN_KAPITEL3_900', '/p/Kapitel3.d', 60),
    ]);
    error.mockRestore();
  });
});

describe('ProjectStore - dropFileFromIndex', () => {
  it("forgets a removed file's sites and NPCs, and the variants that went with them", () => {
    useProjectStore.setState({
      npcFileIndex: { BAU_900_ONAR: '/p/Onar.d', BAU_901_BAUER: '/p/Bauer.d' },
      npcIdIndex: { BAU_900_ONAR: 900, BAU_901_BAUER: 901 },
      routineNpcIndex: { BAU_900_ONAR: 'RTN_START_900', BAU_901_BAUER: 'RTN_START_901' },
      routineSiteIndex: [site('RTN_TOT_901', '/p/Onar.d', 0), site('RTN_START_901', '/p/Bauer.d', 0)],
      routineStateIndex: { BAU_901_BAUER: { id: 901, states: { TOT: 'RTN_TOT_901' } } },
      spawnSiteIndex: [spawn('BAU_900_ONAR', '/p/Onar.d'), spawn('BAU_901_BAUER', '/p/Bauer.d')],
      exchangeSiteIndex: [exchange('TOT', '/p/Onar.d')],
    });

    useProjectStore.getState().dropFileFromIndex('/p/Onar.d');

    const state = useProjectStore.getState();
    expect(state.npcFileIndex).toEqual({ BAU_901_BAUER: '/p/Bauer.d' });
    expect(state.npcIdIndex).toEqual({ BAU_901_BAUER: 901 });
    expect(state.routineNpcIndex).toEqual({ BAU_901_BAUER: 'RTN_START_901' });
    expect(state.routineSiteIndex).toEqual([site('RTN_START_901', '/p/Bauer.d', 0)]);
    expect(state.routineStateIndex).toEqual({});
    expect(state.spawnSiteIndex).toEqual([spawn('BAU_901_BAUER', '/p/Bauer.d')]);
    expect(state.exchangeSiteIndex).toEqual([]);
  });
});

describe('ProjectStore - registerRoutine', () => {
  // A routine the editor just created is known before any reindex: the NPC's
  // declared routine, or a variant under its state, and a function name the
  // project now declares.
  beforeEach(() => {
    useProjectStore.setState({
      routineNpcIndex: { BAU_900_ONAR: 'RTN_START_900' },
      routineStateIndex: { BAU_900_ONAR: { id: 900, states: { TOT: 'RTN_TOT_900' } } },
      functionList: ['B_FOO', 'RTN_START_900', 'RTN_TOT_900'],
    });
  });

  it('records a new variant under its state, beside the ones the NPC has', () => {
    useProjectStore.getState().registerRoutine('BAU_900_Onar', 'Rtn_Ship_900', 'Ship', 900);

    const state = useProjectStore.getState();
    expect(state.routineStateIndex.BAU_900_ONAR).toEqual({ id: 900, states: { TOT: 'RTN_TOT_900', SHIP: 'RTN_SHIP_900' } });
    expect(state.functionList).toEqual(['B_FOO', 'RTN_SHIP_900', 'RTN_START_900', 'RTN_TOT_900']);
  });

  it('records a daily routine as the one the NPC declares', () => {
    useProjectStore.getState().registerRoutine('BAU_901_Bauer', 'Rtn_Start_901', null, 901);
    expect(useProjectStore.getState().routineNpcIndex.BAU_901_BAUER).toBe('RTN_START_901');
  });
});
