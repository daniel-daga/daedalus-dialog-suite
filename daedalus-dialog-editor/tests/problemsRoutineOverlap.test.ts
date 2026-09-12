/**
 * `routine-overlap`: two `TA` entries of one routine in force at the same
 * minute (#235, level-editor.md §16.33).
 *
 * **Why this is a finding at all, and why it has no threshold.** Nothing in
 * the ZEN format, in ZenKit or in this repo says which entry the engine runs
 * when two windows cover a minute — which is why `placementsAt` deliberately
 * returns every entry in force rather than picking one (architecture §8). The
 * NPC's position over that window is therefore undefined by anything the
 * editor can read, and an author almost certainly did not mean it. So any
 * minute covered twice is one finding: no threshold, no discriminator.
 *
 * The severity is a warning, decided by Daniel 2026-09-12 on the measurement
 * §16.33 records: 8 of retail's 1,137 indexed routines overlap, one window
 * each, and there is no tail.
 *
 * The arithmetic itself belongs to `coverageOf` and is tested against the day
 * in `routineSchedule.test.ts`, wrap-around included. What is pinned here is
 * the rule: which routines it reads, what it says, where it points.
 */

import { buildProjectView } from '../src/renderer/problems/domain/projectView';
import { routineOverlapRule } from '../src/renderer/problems/domain/rules/routineOverlap';
import { runRules } from '../src/renderer/problems/domain/runRules';
import type { RoutineSite } from '../src/shared/types';

const site = (
  routine: string, startMinute: number, endMinute: number, line: number, waypoint = 'WP_A',
): RoutineSite => ({
  routine, startMinute, endMinute, waypoint, filePath: 'Story/Rtn_Diego.d', line,
});

const view = (routineSites?: readonly RoutineSite[]) =>
  buildProjectView({ files: [], knownNpcNames: [], routineSites });

/** A day partitioned in two — retail's ordinary shape, and no finding. */
const CLEAN: RoutineSite[] = [site('RTN_START_DIEGO', 8 * 60, 20 * 60, 10), site('RTN_START_DIEGO', 20 * 60, 8 * 60, 11)];

describe('routineOverlapRule', () => {
  it('says nothing while the project index holds no routines', () => {
    // An empty index is nothing known, never nothing legal — the same rule the
    // waypoint and duplicate-spawn checks keep.
    expect(routineOverlapRule(view(undefined))).toEqual([]);
    expect(routineOverlapRule(view([]))).toEqual([]);
  });

  it('says nothing about a routine that partitions the day', () => {
    expect(routineOverlapRule(view(CLEAN))).toEqual([]);
  });

  it('says nothing about a routine with a hole in the day', () => {
    // A gap is legal and common at half-day scale, and its threshold is
    // nobody's yet (#236). This rule is the overlap half only.
    expect(routineOverlapRule(view([site('RTN_START_MUD', 8 * 60, 12 * 60, 4)]))).toEqual([]);
  });

  it('reports a routine whose entries cover one window twice, naming the window', () => {
    const problems = routineOverlapRule(view([
      site('RTN_START_DIEGO', 8 * 60, 14 * 60, 10, 'OW_PATH_01'),
      site('RTN_START_DIEGO', 12 * 60, 20 * 60, 11, 'OW_PATH_02'),
      site('RTN_START_DIEGO', 20 * 60, 8 * 60, 12, 'OW_PATH_03'),
    ]));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toEqual({
      id: 'routine-overlap:RTN_START_DIEGO:720',
      rule: 'routine-overlap',
      severity: 'warning',
      message:
        'Routine "RTN_START_DIEGO" has two entries in force from 12:00 to 14:00. '
        + 'Nothing in the format says which the engine runs, so the NPC\'s position over '
        + 'that window is undefined.',
      locus: { kind: 'script', filePath: 'Story/Rtn_Diego.d', functionName: 'RTN_START_DIEGO' },
    });
  });

  it('reports a window that runs across midnight as one window', () => {
    // The day is a circle: 23:00 and 01:00 are the same overlap, and two
    // findings for it would be the interval bug `coverageOf` exists to avoid.
    const problems = routineOverlapRule(view([
      site('RTN_START_NIGHT', 22 * 60, 2 * 60, 1),
      site('RTN_START_NIGHT', 23 * 60, 1 * 60, 2),
      site('RTN_START_NIGHT', 2 * 60, 22 * 60, 3),
    ]));

    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('from 23:00 to 01:00');
  });

  it('reports every overlapping window of one routine separately', () => {
    const problems = routineOverlapRule(view([
      site('RTN_START_X', 0, 12 * 60, 1),
      site('RTN_START_X', 2 * 60, 3 * 60, 2),
      site('RTN_START_X', 6 * 60, 7 * 60, 3),
      site('RTN_START_X', 12 * 60, 24 * 60, 4),
    ]));

    expect(problems.map((p) => p.id)).toEqual([
      'routine-overlap:RTN_START_X:120',
      'routine-overlap:RTN_START_X:360',
    ]);
  });

  it('reads each routine once, however many entries name it', () => {
    // `coverageOf` sweeps 1,440 minutes per call; retail's index is 1,137
    // routines over ~4,000 entries, so a call per entry would be four times
    // the work for the same answer.
    const problems = routineOverlapRule(view([
      ...CLEAN,
      site('RTN_START_MUD', 0, 13 * 60, 20),
      site('RTN_START_MUD', 12 * 60, 24 * 60, 21),
    ]));

    expect(problems.map((p) => p.rule)).toEqual(['routine-overlap']);
    expect(problems[0].message).toContain('RTN_START_MUD');
  });

  it('points at the file and function of the routine, not of one entry', () => {
    // The entries of one routine are in one function by construction — a `TA`
    // call is inside the routine it names — so the first entry's file is the
    // routine's file, and the function name is the routine itself.
    const problems = routineOverlapRule(view([
      site('RTN_START_DIEGO', 0, 13 * 60, 10),
      site('RTN_START_DIEGO', 12 * 60, 24 * 60, 11),
    ]));

    expect(problems[0].locus).toEqual({
      kind: 'script', filePath: 'Story/Rtn_Diego.d', functionName: 'RTN_START_DIEGO',
    });
  });
});

describe('the rule in the registry', () => {
  it('runs as part of a scan', () => {
    const problems = runRules(buildProjectView({
      files: [],
      knownNpcNames: [],
      routineSites: [
        site('RTN_START_DIEGO', 0, 13 * 60, 10),
        site('RTN_START_DIEGO', 12 * 60, 24 * 60, 11),
      ],
    }));

    expect(problems.some((p) => p.rule === 'routine-overlap')).toBe(true);
  });
});
