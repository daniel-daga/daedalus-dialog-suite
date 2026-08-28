import { waypointNotInWorldRule } from '../src/renderer/problems/domain/rules/waypointNotInWorld';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { WaypointSites, WorldWaynetView } from '../src/renderer/problems/domain/types';

const world = (names: string[], freePoints: string[] = []): WorldWaynetView => ({
  pointNameKeys: new Set([...names, ...freePoints].map((name) => name.toUpperCase())),
  freePointNames: freePoints.map((name) => name.toUpperCase())
});

const viewOf = (waypointSites: WaypointSites, worldView?: WorldWaynetView) =>
  buildProjectView({ files: [], knownNpcNames: [], waypointSites, world: worldView });

const site = (filePath: string, functionName: string) => ({ filePath, functionName });

describe('waypointNotInWorldRule', () => {
  it('returns nothing when no world is open, however many sites dangle', () => {
    const view = viewOf({ NW_CITY_01: [site('Rtn.d', 'Rtn_Start_Diego')] });
    expect(waypointNotInWorldRule(view)).toEqual([]);
  });

  it('flags a site whose waypoint the open world does not have', () => {
    const view = viewOf(
      { OW_PATH_42: [site('Rtn.d', 'Rtn_Start_Diego')] },
      world(['NW_CITY_01'])
    );

    const problems = waypointNotInWorldRule(view);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      rule: 'waypoint-not-in-world',
      severity: 'warning',
      filePath: 'Rtn.d',
      functionName: 'Rtn_Start_Diego'
    });
    // The third answer is not knowable from one world: the message may never
    // claim the waypoint is missing, only that it is not in *this* world.
    expect(problems[0].message).toContain('OW_PATH_42');
    expect(problems[0].message).toMatch(/not in .*world/i);
    expect(problems[0].message).not.toMatch(/missing|does not exist|no such/i);
  });

  it('emits one problem per site of the same dangling name', () => {
    const view = viewOf(
      { OW_PATH_42: [site('a.d', 'Rtn_Start_A'), site('b.d', 'Rtn_Start_B')] },
      world(['NW_CITY_01'])
    );

    const problems = waypointNotInWorldRule(view);
    expect(problems.map((problem) => problem.filePath)).toEqual(['a.d', 'b.d']);
    expect(new Set(problems.map((problem) => problem.id)).size).toBe(2);
  });

  it('matches waypoint names case-insensitively', () => {
    const view = viewOf(
      { nw_city_01: [site('Rtn.d', 'Rtn_Start_Diego')] },
      world(['NW_City_01'])
    );
    expect(waypointNotInWorldRule(view)).toEqual([]);
  });

  it('accepts a free-point prefix, which is how the engine matches one', () => {
    // `Wld_IsFPAvailable(self, "FP_ROAM")` reaches FP_ROAM_CITY_01 in the
    // engine, so an exact-match rule would invent a finding here.
    const view = viewOf(
      { FP_ROAM: [site('Rtn.d', 'Rtn_Start_Diego')] },
      world(['NW_CITY_01'], ['FP_ROAM_CITY_01'])
    );
    expect(waypointNotInWorldRule(view)).toEqual([]);
  });

  it('does not prefix-match ordinary waypoints', () => {
    // Only free points are prefix-matched; a routine naming `NW_CITY` when the
    // world holds only `NW_CITY_01` really does dangle.
    const view = viewOf(
      { NW_CITY: [site('Rtn.d', 'Rtn_Start_Diego')] },
      world(['NW_CITY_01'])
    );
    expect(waypointNotInWorldRule(view)).toHaveLength(1);
  });

  it('is silent on an open world with no script sites', () => {
    expect(waypointNotInWorldRule(viewOf({}, world(['NW_CITY_01'])))).toEqual([]);
  });
});
