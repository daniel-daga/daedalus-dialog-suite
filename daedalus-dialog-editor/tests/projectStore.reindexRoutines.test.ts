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
