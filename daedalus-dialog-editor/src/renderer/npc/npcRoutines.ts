import type { ExchangeSite, RoutineSite } from '../../shared/types';
import type { RoutineIndex } from '../routines/routineSchedule';
import type { RoutineEntry } from '../routines/routineEntries';

// The NPC editor's read-only routines section (docs/plans/npc-editor.md,
// Phase 2): the routine the instance declares, then every state variant the
// project index enumerates for it, each with its TA entries. Pure.

export interface NpcRoutine {
  /** "Daily" for the declared `daily_routine`, else the state name. */
  label: string;
  routine: string;
  /** In order of start time. */
  entries: RoutineSite[];
}

export function npcRoutines(index: RoutineIndex, npc: string): NpcRoutine[] {
  const key = npc.toUpperCase();
  const declared = index.routinesByNpc[key];
  const entriesOf = (routine: string) => index.sites
    .filter((site) => site.routine.toUpperCase() === routine.toUpperCase())
    .sort((a, b) => a.startMinute - b.startMinute);

  const routines: NpcRoutine[] = declared ? [{ label: 'Daily', routine: declared, entries: entriesOf(declared) }] : [];
  for (const [state, routine] of Object.entries(index.statesByNpc?.[key]?.states ?? {})) {
    // The declared routine is usually also a state (START); it is listed once.
    if (routine === declared) continue;
    routines.push({ label: state, routine, entries: entriesOf(routine) });
  }
  return routines;
}

/** The NPC (UPPERCASED) whose daily routine or state variant `routine` is,
 *  or null when the index knows none — the waypoint panel's "whose stop". */
export function routineOwner(index: RoutineIndex, routine: string): string | null {
  const wanted = routine.toUpperCase();
  for (const [npc, declared] of Object.entries(index.routinesByNpc)) {
    if (declared.toUpperCase() === wanted) return npc;
  }
  for (const [npc, { states }] of Object.entries(index.statesByNpc ?? {})) {
    if (Object.values(states).some((each) => each.toUpperCase() === wanted)) return npc;
  }
  return null;
}

/** A routine's stops as the index holds them, in script order — the order the
 *  routine editor lists and colours them in — for drawing it unedited. */
export function routinePreview(sites: readonly RoutineSite[], routine: string): RoutineEntry[] {
  const wanted = routine.toUpperCase();
  return sites
    .filter((site) => site.routine.toUpperCase() === wanted)
    .sort((a, b) => a.line - b.line)
    .map((site) => ({
      state: site.stateName ?? '', startMinute: site.startMinute, endMinute: site.endMinute, waypoint: site.waypoint,
    }));
}

export interface VariantSwitch extends ExchangeSite {
  /** The chapter the switching function or the state is named for, if any. */
  chapter: number | null;
  /** Targets `self`, which the index cannot resolve to this NPC. */
  maybeOtherNpc: boolean;
}

const CHAPTER = /KAPITEL_?(\d+)$/i;

/**
 * The literal calls that switch `npc` to `state` (npc-editor.md §6). A routine
 * changes with the chapter only because a script switches to a variant, so
 * the chapter a variant belongs to is read off the switch: a function named
 * for the chapter (`B_Enter_NewWorld_Kapitel_3`) or a state named for it
 * (`Kapitel4`). Anything else is `null` — never guessed.
 */
export function variantSwitches(sites: readonly ExchangeSite[], npc: string, state: string): VariantSwitch[] {
  const target = npc.toUpperCase();
  const wanted = state.toUpperCase();
  const stateChapter = CHAPTER.exec(wanted);
  return sites
    .filter((site) => site.state === wanted && (site.target === target || site.target === 'SELF'))
    .map((site) => {
      const chapter = CHAPTER.exec(site.functionName) ?? stateChapter;
      return { ...site, chapter: chapter ? Number(chapter[1]) : null, maybeOtherNpc: site.target === 'SELF' };
    });
}

export function formatMinute(minute: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}
