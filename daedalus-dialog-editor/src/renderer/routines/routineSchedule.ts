import type { RoutineSite, SpawnSite } from '../../shared/types';

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
  /**
   * The routine variants quest state swaps in, keyed by UPPERCASED NPC
   * (§16.19 slice 11). Optional: an index without it behaves exactly as it did
   * before the lens existed, which is also what an empty one does.
   */
  statesByNpc?: Readonly<Record<string, { id: number; states: Readonly<Record<string, string>> }>>;
}

/**
 * Which routine an NPC runs under the chosen state.
 *
 * **The fallback is the lens's semantics, not a convenience.** A state names
 * the NPCs it exists for; for everyone else the chosen state says nothing, so
 * they keep the strongest fact available — the day their instance declares.
 * Reading it as "this NPC is not in that state" would be inventing a claim the
 * scripts do not make.
 */
function routineFor(
  index: RoutineIndex,
  instance: string,
  declared: string,
  state: string | null
): string {
  if (!state) return declared;
  return index.statesByNpc?.[instance]?.states?.[state] || declared;
}

/**
 * How many NPCs a chosen state actually moves, against how many it could.
 *
 * This is what stops *State: TOT* over a world where one NPC moved from
 * reading as "the world is in TOT" — the same job slice 7's grey markers do for
 * the unmeasured coverage, and the reason the picker is not allowed to ship
 * without it. The denominator is the NPCs whose day is known at all, because
 * those are the only ones a state could move.
 */
export function stateReach(
  index: RoutineIndex,
  state: string | null
): { resolved: number; total: number } {
  const total = Object.keys(index.routinesByNpc).length;
  if (!state) return { resolved: 0, total };

  let resolved = 0;
  for (const instance of Object.keys(index.routinesByNpc)) {
    if (index.statesByNpc?.[instance]?.states?.[state]) resolved += 1;
  }
  return { resolved, total };
}

/** One entry of the State select: a state name and how many NPCs have a variant for it. */
export interface StateOption {
  name: string;
  reach: number;
}

/**
 * The State select's option list, split the way slice 11's measurement said
 * to (§16.19): 112 of retail's 182 names reach one NPC, and flat alphabetical
 * puts those between the names anyone would pick. So names more than one NPC
 * shares come first, by reach (ties alphabetical), and the singletons after,
 * alphabetical — the caller draws the divider. Reach here is counted over the
 * state index alone, which is what the list is built from; `stateReach` is
 * the readout against the NPCs whose day is known, a different denominator.
 */
export function stateOptions(index: RoutineIndex): { shared: StateOption[]; singletons: StateOption[] } {
  const reachByName = new Map<string, number>();
  for (const npc of Object.values(index.statesByNpc ?? {})) {
    for (const name of Object.keys(npc.states)) {
      reachByName.set(name, (reachByName.get(name) ?? 0) + 1);
    }
  }
  const options = [...reachByName].map(([name, reach]) => ({ name, reach }));
  options.sort((a, b) => b.reach - a.reach || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    shared: options.filter((option) => option.reach > 1),
    singletons: options.filter((option) => option.reach === 1)
  };
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

/**
 * Where every NPC with a declared routine stands at `minute`, optionally seen
 * through a quest state — see `routineFor` for what a state does and does not
 * claim.
 */
export function placementsAt(
  index: RoutineIndex,
  minute: number,
  state: string | null = null
): RoutinePlacement[] {
  const byRoutine = new Map<string, RoutineSite[]>();
  for (const site of index.sites) {
    const entries = byRoutine.get(site.routine);
    if (entries) entries.push(site);
    else byRoutine.set(site.routine, [site]);
  }

  return Object.entries(index.routinesByNpc).map(([instance, declared]) => {
    const routine = routineFor(index, instance, declared, state);
    return {
      instance,
      routine,
      entries: (byRoutine.get(routine) || []).filter((site) => windowCovers(site, minute))
    };
  });
}

/**
 * The waypoints the spawn overlay draws at one minute, in two lists.
 *
 * Two rather than one because the day splits NPCs three ways and only one of
 * the three is a position the script actually states. An NPC whose routine
 * covers the minute is **known** — the script puts him there. An NPC whose
 * routine has a hole there, and an NPC who declares no routine at all, are both
 * **unknown**: the only position anything states for them is the static spawn
 * `Wld_InsertNpc` gave them, which is where they were *inserted* and not where
 * the script says they are now. Drawn in one list those two facts would be
 * indistinguishable, and the weaker one would be read as the stronger.
 *
 * Waypoint names, not positions: resolving a name to a point needs the waynet,
 * and the overlay is what holds it. That is also what scopes this to the world
 * on screen — a waypoint the world has not got is dropped there, so an NPC
 * whose routine names a waypoint in another world simply does not draw, and no
 * filtering is needed here.
 */
export interface TimedPlacements {
  /** Waypoints the script positively puts an NPC on at this minute. */
  known: string[];
  /** Static spawns of the NPCs whose position at this minute is not stated. */
  unknown: string[];
  /**
   * Who is standing on each of those waypoints — UPPERCASED instance names,
   * sorted, keyed by the waypoint name in either list above (§16.19 slice 14).
   *
   * The lists are what to *draw*; this is what to *call it*. Each point is
   * described by the same layer's fact and no other: a known point names the
   * NPCs a routine puts there, and an NPC merely inserted at that point stays
   * out of it, because separating those two facts is the entire reason there
   * are two lists. `placementsAt` has carried the instance all along; slice 9
   * left the label as the waypoint's own name only because nothing here
   * passed it on.
   */
  occupants: Record<string, string[]>;
}

/**
 * The static spawns grouped by the point they insert at — what the layer draws
 * before the slider is touched, where there is no minute to ask a routine
 * about.
 */
export function spawnOccupants(spawns: readonly SpawnSite[]): Record<string, string[]> {
  const occupants: Record<string, string[]> = {};
  for (const site of spawns) add(occupants, site.spawnPoint, site.instance);
  return sorted(occupants);
}

/** One name onto one point, without repeating it. */
function add(occupants: Record<string, string[]>, point: string, instance: string): void {
  const standing = occupants[point];
  if (standing === undefined) occupants[point] = [instance];
  else if (!standing.includes(instance)) standing.push(instance);
}

/**
 * Alphabetical, because a label draws the first name and counts the rest: 175
 * NPCs stand on `NW_CITY_ENTRANCE_01` (§16.22 q4) and which of them is named
 * must not depend on the order an index happened to enumerate its NPCs in.
 */
function sorted(occupants: Record<string, string[]>): Record<string, string[]> {
  for (const point of Object.keys(occupants)) occupants[point].sort();
  return occupants;
}

export function placementWaypointsAt(
  index: RoutineIndex,
  spawns: readonly SpawnSite[],
  minute: number,
  state: string | null = null
): TimedPlacements {
  const known = new Set<string>();
  /** The NPCs a routine entry positions — the rest fall back to their spawn. */
  const positioned = new Set<string>();
  const occupants: Record<string, string[]> = {};

  for (const placement of placementsAt(index, minute, state)) {
    // Empty entries is "the script does not say", which is the unknown case and
    // not a position. Every entry of an overlap is taken: `placementsAt` picks
    // no winner on purpose, so an NPC the routine puts in two places is drawn
    // in two places.
    if (placement.entries.length === 0) continue;
    positioned.add(placement.instance);
    for (const entry of placement.entries) {
      known.add(entry.waypoint);
      add(occupants, entry.waypoint, placement.instance);
    }
  }

  const unknown = new Set<string>();
  for (const site of spawns) {
    if (positioned.has(site.instance)) continue;
    // One marker per point (§16.19 slice 4), so a point in both lists would be
    // two markers in two colours on one spot. Known wins: that the script
    // places somebody here now is the stronger of the two facts, and who else
    // is standing there is the waypoint panel's answer rather than a marker's.
    if (known.has(site.spawnPoint)) continue;
    unknown.add(site.spawnPoint);
    add(occupants, site.spawnPoint, site.instance);
  }

  return { known: [...known], unknown: [...unknown], occupants: sorted(occupants) };
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
