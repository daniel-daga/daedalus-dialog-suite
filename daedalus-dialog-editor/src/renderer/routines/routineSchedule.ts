import type { RoutineSite } from '../../shared/types';

/**
 * The daily schedule a project's routines describe — slice 2 of the Daedalus
 * overlay (level-editor.md §16.19), over the routine index slice 1 built.
 *
 * Pure: no React, no Three.js, no IPC. The day's arithmetic is the whole
 * content of this module and it is testable without a viewport, which is the
 * same split `quest/domain` and `problems/domain` keep.
 *
 * **It resolves a minute to entries, never to one entry.** Nothing in the ZEN
 * format, in ZenKit or in this repo says which `TA_*` entry the engine picks
 * when two windows overlap, and no measurement here could settle it — so an
 * overlap comes back as both entries and the caller decides what to draw.
 * Inventing a precedence would be a rule the game does not have.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** A stretch of the day, half-open `[start, end)`; `end <= start` wraps midnight. */
export interface RoutineWindow {
  startMinute: number;
  endMinute: number;
}

export interface RoutineIndex {
  sites: readonly RoutineSite[];
  /** UPPERCASED NPC instance to UPPERCASED routine function. */
  routinesByNpc: Readonly<Record<string, string>>;
}

export interface RoutinePlacement {
  instance: string;
  routine: string;
  /**
   * Every entry in force at the minute asked for, in index order. Empty means
   * the script does not say where this NPC is — either the routine has a hole
   * there, or the index never read the routine at all, and those look the same
   * from here on purpose: an empty index means nothing is known, never that
   * nothing is legal. `coverageOf` is what tells the two apart, because it only
   * ever sees a routine that has entries.
   */
  entries: readonly RoutineSite[];
}

/**
 * Does a window hold this minute? Half-open at both ends, so retail's
 * `(06,00,24,00)` + `(24,00,06,00)` pair partitions the day instead of
 * colliding on minute 0 — and `(00,00,00,00)`, the idiom for a routine with
 * one entry, is the whole day rather than nothing.
 */
export function windowCovers(window: RoutineWindow, minute: number): boolean {
  const { startMinute, endMinute } = window;
  if (endMinute > startMinute) return minute >= startMinute && minute < endMinute;
  return minute >= startMinute || minute < endMinute;
}

/** Where every NPC with a declared routine stands at `minute`. */
export function placementsAt(index: RoutineIndex, minute: number): RoutinePlacement[] {
  const byRoutine = new Map<string, RoutineSite[]>();
  for (const site of index.sites) {
    const entries = byRoutine.get(site.routine);
    if (entries) entries.push(site);
    else byRoutine.set(site.routine, [site]);
  }

  return Object.entries(index.routinesByNpc).map(([instance, routine]) => ({
    instance,
    routine,
    entries: (byRoutine.get(routine) || []).filter((site) => windowCovers(site, minute))
  }));
}

/**
 * Which minutes of the day one routine leaves uncovered, and which it covers
 * more than once — §11's gap and overlap checks, as a measurement rather than
 * as a rule.
 *
 * It is deliberately not a Problems rule: §16.19 records those as uncarded
 * because nobody has said what the finding should be, and §16.22's precedent is
 * that the number comes first and the check second. This is the instrument that
 * number comes from.
 *
 * A minute at a time rather than interval arithmetic, because the day is a
 * circle and every wrap-around edge case an interval merge would have to get
 * right is one this cannot get wrong. 1,440 counters per routine.
 */
export function coverageOf(
  sites: readonly RoutineSite[],
  routine: string
): { routine: string; gaps: RoutineWindow[]; overlaps: RoutineWindow[] } {
  const covering = new Uint16Array(MINUTES_PER_DAY);
  let read = false;

  for (const site of sites) {
    if (site.routine !== routine) continue;
    read = true;
    for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
      if (windowCovers(site, minute)) covering[minute] += 1;
    }
  }

  if (!read) return { routine, gaps: [], overlaps: [] };

  return {
    routine,
    gaps: runsOf(covering, (count) => count === 0),
    overlaps: runsOf(covering, (count) => count > 1)
  };
}

/**
 * The stretches where `matches` holds, as half-open windows. A run either side
 * of midnight is one window — the day is a circle, so a hole at 23:00 and a
 * hole at 01:00 are the same hole.
 */
function runsOf(covering: Uint16Array, matches: (count: number) => boolean): RoutineWindow[] {
  const windows: RoutineWindow[] = [];
  let start: number | null = null;

  for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
    const inRun = matches(covering[minute]);
    if (inRun && start === null) start = minute;
    else if (!inRun && start !== null) {
      windows.push({ startMinute: start, endMinute: minute });
      start = null;
    }
  }

  if (start !== null) windows.push({ startMinute: start, endMinute: MINUTES_PER_DAY });
  if (windows.length === 0) return windows;

  // Whole day: one run with nothing to join to.
  const first = windows[0];
  const last = windows[windows.length - 1];
  if (windows.length === 1 && first.startMinute === 0 && first.endMinute === MINUTES_PER_DAY) {
    return [{ startMinute: 0, endMinute: 0 }];
  }

  // A run reaching midnight from both sides is one run across it.
  if (first.startMinute === 0 && last.endMinute === MINUTES_PER_DAY) {
    windows.pop();
    windows.shift();
    windows.push({ startMinute: last.startMinute, endMinute: first.endMinute });
  }

  return windows.map((window) => ({
    startMinute: window.startMinute,
    endMinute: window.endMinute === MINUTES_PER_DAY ? 0 : window.endMinute
  }));
}
