import type { RoutineSite } from '../../shared/types';
import type { RoutineIndex } from '../routines/routineSchedule';

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

export function formatMinute(minute: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}
