import type { RoutineSite } from '../../../../shared/types';
import type { LintRule, Problem } from '../types';
import { coverageOf, type RoutineWindow } from '../../../routines/routineSchedule';

/**
 * `routine-overlap`: two `TA` entries of one routine in force at the same
 * minute (#235, level-editor.md §16.33), over the routine index §16.19 slice 1
 * built.
 *
 * **Why an overlap is reportable, and why it has no threshold.** Nothing in
 * the ZEN format, in ZenKit or in this repo says which entry the engine runs
 * when two windows cover a minute — which is exactly why `placementsAt`
 * returns *every* entry in force rather than picking one (architecture §8):
 * a precedence would be a rule the game does not have. That is what makes the
 * overlap a finding rather than a style note. The NPC's position over that
 * window is undefined by anything the editor can read, and an author almost
 * certainly did not mean it. So any minute covered twice is one, and there is
 * nothing left for a threshold to decide.
 *
 * **The measurement, and the decision it supports.** 8 of retail's 1,137
 * routines with an indexed entry cover a window twice, one window each — no
 * tail, which is why §16.22's precedent left this uncarded rather than killing
 * it as it killed occupancy. A rule that fires 8 times on the whole of Gothic
 * II is worth having as a **warning**: Daniel, 2026-09-12, which is the half
 * §16.33 said was missing.
 *
 * **The gap half is not this rule** (#236). A hole in the day is legal and
 * common at half-day scale — an NPC with a twelve-hour routine is elsewhere
 * the other twelve — so it is a threshold question nobody has answered. An
 * overlap is a day the scripts do not determine, which is a different claim.
 *
 * The arithmetic is `coverageOf`'s, unchanged: a minute at a time over 1,440
 * counters, so every wrap-around case is one this cannot get wrong. It is
 * called once per *routine* rather than once per entry — retail's index is
 * 1,137 routines over some 4,000 entries, and a sweep per entry would be four
 * times the work for the same answer.
 */
export const routineOverlapRule: LintRule = (view): Problem[] => {
  const { routineSites } = view;
  if (routineSites.length === 0) return [];

  // Grouped rather than filtered per routine: `coverageOf` filters the whole
  // list by name, so calling it for N routines over a flat list is N passes
  // over every entry in the project.
  const first = new Map<string, RoutineSite>();
  for (const site of routineSites) {
    if (!first.has(site.routine)) first.set(site.routine, site);
  }

  const problems: Problem[] = [];
  for (const [routine, anchor] of first) {
    for (const window of coverageOf(routineSites, routine).overlaps) {
      problems.push({
        // The window's start, so the id is stable across a re-scan and two
        // overlapping windows in one routine are two rows.
        id: `routine-overlap:${routine}:${window.startMinute}`,
        rule: 'routine-overlap',
        severity: 'warning',
        message:
          `Routine "${routine}" has two entries in force from ${clock(window)}. `
          + 'Nothing in the format says which the engine runs, so the NPC\'s position over '
          + 'that window is undefined.',
        // The entries of one routine are inside the function that declares it
        // — a `TA` call is in the routine it names — so any entry's file is
        // the routine's file, and the function name is the routine itself.
        locus: { kind: 'script', filePath: anchor.filePath, functionName: routine },
      });
    }
  }

  return problems;
};

/** `12:00 to 14:00` — how a `TA` entry is written, rather than minutes. */
const clock = ({ startMinute, endMinute }: RoutineWindow): string =>
  `${hhmm(startMinute)} to ${hhmm(endMinute)}`;

const hhmm = (minute: number): string => {
  // The whole day comes back as `{ 0, 0 }`, which reads as 00:00 to 00:00 —
  // a full circle, and the honest rendering of a routine overlapping itself
  // all day.
  const hour = Math.floor(minute / 60) % 24;
  return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
};
