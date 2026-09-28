import { useProjectStore } from '../src/renderer/store/projectStore';
import type { RoutineSite } from '../src/shared/types';

// After a routine save (npc-editor.md §6) the saved file's routine sites are
// read again in main and replace that file's entries — nothing re-indexed a
// routine after a load before, so the map, the time lens and the Problems
// rules kept showing the day as it was when the project opened.

const site = (routine: string, filePath: string, startMinute: number): RoutineSite => ({
  routine, stateName: 'TA_SIT', startMinute, endMinute: startMinute + 60, waypoint: 'WP', filePath, line: 3,
});

describe('ProjectStore - reindexRoutineSites', () => {
  let original: unknown;
  beforeEach(() => { original = window.editorAPI.routineSitesOfFile; });
  afterEach(() => {
    window.editorAPI.routineSitesOfFile = original as typeof window.editorAPI.routineSitesOfFile;
  });

  it("replaces that file's sites with what main reads, with the project's layouts, and keeps every other file's", async () => {
    const layouts = { TA_SIT: { startH: 0, startM: 1, stopH: 2, stopM: 3, waypoint: 4 } };
    useProjectStore.setState({
      routineLayoutIndex: layouts,
      routineSiteIndex: [site('RTN_A', '/p/A.d', 60), site('RTN_B', '/p/B.d', 120), site('RTN_A', '/p/A.d', 180)],
    });
    const reread = jest.fn(async () => [site('RTN_A', '/p/A.d', 600)]);
    window.editorAPI.routineSitesOfFile = reread;

    await useProjectStore.getState().reindexRoutineSites('/p/A.d');

    expect(reread).toHaveBeenCalledWith('/p/A.d', layouts);
    expect(useProjectStore.getState().routineSiteIndex).toEqual([
      site('RTN_B', '/p/B.d', 120),
      site('RTN_A', '/p/A.d', 600),
    ]);
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
