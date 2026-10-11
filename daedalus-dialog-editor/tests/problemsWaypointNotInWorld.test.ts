import { waypointNotInWorldRule } from '../src/renderer/problems/domain/rules/waypointNotInWorld';
import { worldHasPoint } from '../src/renderer/problems/domain/types';
import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import type { Problem, WaypointSites, WorldWaynetView } from '../src/renderer/problems/domain/types';

/** The file a script problem names; `undefined` for a world locus. */
const filePathOf = (problem: Problem): string | undefined =>
  (problem.locus.kind === 'script' ? problem.locus.filePath : undefined);

/**
 * A world open with these waynet waypoints and these free points.
 *
 * **The two sets are disjoint, because in a real world they are.** A free
 * point is a `zCVobSpot` VOB, not a waypoint: retail NewWorld holds 2,254 of
 * them and **no** waypoint named `FP_*` at all. An earlier version of this
 * helper unioned the free points into `pointNameKeys`, which is a world that
 * cannot exist — and it hid the defect that the store was reading free points
 * off the waynet's stored `free_point` flag, a field that marks 1 waypoint in
 * NewWorld and none of the ones scripts name.
 */
const world = (names: string[], freePoints: string[] = []): WorldWaynetView => ({
  pointNameKeys: new Set(names.map((name) => name.toUpperCase())),
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
      locus: { kind: 'script', filePath: 'Rtn.d', functionName: 'Rtn_Start_Diego', waypoint: 'OW_PATH_42' }
    });
    // The third answer is not knowable from one world: the message may never
    // claim the waypoint is missing, only that it is not in *this* world.
    expect(problems[0].message).toContain('OW_PATH_42');
    expect(problems[0].message).toMatch(/not in .*world/i);
    expect(problems[0].message).not.toMatch(/missing|does not exist|no such/i);
  });

  it('carries the name in the script\'s own casing, not the site key\'s upper case', () => {
    // `waypointSites` is keyed uppercase (Daedalus is case-insensitive), but the
    // locus is what an "add to world" action would send to `AddWaypoint` — and
    // the world it is about to join is case-sensitive.
    const view = viewOf(
      { ow_path_42: [site('Rtn.d', 'Rtn_Start_Diego')] },
      world(['NW_CITY_01'])
    );

    const problems = waypointNotInWorldRule(view);
    expect(problems[0].locus).toMatchObject({ waypoint: 'ow_path_42' });
  });

  it('emits one problem per site of the same dangling name', () => {
    const view = viewOf(
      { OW_PATH_42: [site('a.d', 'Rtn_Start_A'), site('b.d', 'Rtn_Start_B')] },
      world(['NW_CITY_01'])
    );

    const problems = waypointNotInWorldRule(view);
    expect(problems.map(filePathOf)).toEqual(['a.d', 'b.d']);
    expect(new Set(problems.map((problem) => problem.id)).size).toBe(2);
  });

  it('emits one problem for a function naming the same waypoint twice', () => {
    // The normal Gothic routine shape: `Rtn_Start_Diego` walks to the same
    // place twice. Two sites, one id — and `ProblemsList` keys on the id.
    const view = viewOf(
      { OW_PATH_42: [site('Rtn.d', 'Rtn_Start_Diego'), site('Rtn.d', 'Rtn_Start_Diego')] },
      world(['NW_CITY_01'])
    );

    const problems = waypointNotInWorldRule(view);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      locus: { kind: 'script', filePath: 'Rtn.d', functionName: 'Rtn_Start_Diego' }
    });
  });

  it('matches waypoint names case-insensitively', () => {
    const view = viewOf(
      { nw_city_01: [site('Rtn.d', 'Rtn_Start_Diego')] },
      world(['NW_City_01'])
    );
    expect(waypointNotInWorldRule(view)).toEqual([]);
  });

  it('accepts a free point by its own full name, which is what a spawn names', () => {
    // 496 of NewWorld's 874 FP_ sites are exactly this: `Wld_InsertNpc` with
    // the whole `zCVobSpot` name. They are not waypoints, so the free-point
    // set is the only thing that can answer for them.
    const view = viewOf(
      { FP_ROAM_CITY_01: [site('Rtn.d', 'Rtn_Start_Diego')] },
      world(['NW_CITY_01'], ['FP_ROAM_CITY_01'])
    );
    expect(waypointNotInWorldRule(view)).toEqual([]);
  });

  it('accepts a free-point prefix, which is how a herd spawn names one', () => {
    // Retail does this once: `FP_ROAM_OW_SNAPPER_OW_ORC` for `…_ORC6/7/8`.
    const view = viewOf(
      { FP_ROAM_OW_SNAPPER_OW_ORC: [site('Rtn.d', 'Rtn_Start_Snapper')] },
      world(['NW_CITY_01'], ['FP_ROAM_OW_SNAPPER_OW_ORC8'])
    );
    expect(waypointNotInWorldRule(view)).toEqual([]);
  });

  it('accepts a free-point fragment from the middle of the name', () => {
    // `Wld_IsFPAvailable(self, "ROAM")` reaches FP_ROAM_CITY_01 in the engine:
    // the search is by substring, and `FP_` is a prefix every free point has,
    // so a script fragment is almost never a prefix of one. A prefix-matching
    // guard invents a finding for legal code — the thing this branch exists to
    // prevent. It reaches the rule when a project's own helper declares a
    // `var string waypoint` parameter and is called with the fragment.
    const view = viewOf(
      { ROAM: [site('Rtn.d', 'Rtn_Start_Diego')] },
      world(['NW_CITY_01'], ['FP_ROAM_CITY_01'])
    );
    expect(waypointNotInWorldRule(view)).toEqual([]);
  });

  it('does not read the empty name as a free point every world has', () => {
    // Every string contains `''`, so a substring match without a guard answers
    // true for any world holding one free point. No site carries an empty name
    // — the extractor drops those — but the shared resolver is what a text
    // field being typed into will ask next.
    expect(worldHasPoint(world(['NW_CITY_01'], ['FP_ROAM_CITY_01']), '')).toBe(false);
  });

  it('still flags a free-point name no free point contains', () => {
    const view = viewOf(
      { FP_ROAM_NOWHERE: [site('Rtn.d', 'Rtn_Start_Diego')] },
      world(['NW_CITY_01'], ['FP_ROAM_CITY_01'])
    );
    expect(waypointNotInWorldRule(view)).toHaveLength(1);
  });

  it('does not fragment-match ordinary waypoints', () => {
    // Only free points are matched loosely; a routine naming `NW_CITY` when the
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
