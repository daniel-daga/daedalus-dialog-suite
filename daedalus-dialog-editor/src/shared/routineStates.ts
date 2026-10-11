import type { RoutineSite } from './types';

/**
 * The routine variants quest state swaps in, keyed by NPC (level-editor.md
 * §16.19 slice 11). Shared because the load derives it in main and the
 * renderer derives it again when a file changes (#319).
 *
 * **The grouping rule is the engine's, not an observed naming style.**
 * `Npc_ExchangeRoutine(npc, "X")` makes the engine run `RTN_X_<id>`, where
 * `id` is the C_NPC instance's own `id` field — so a variant is found by
 * stripping `RTN_` from the front of an indexed routine function and the NPC's
 * id from the back, and what is left is the state name. Splitting on the
 * *known* id rather than guessing where the state name ends is what keeps
 * `Rtn_Addon_Tot_4300` intact as `ADDON_TOT`.
 *
 * Variants are enumerated from the routine functions the index already read,
 * never from the exchange call sites: an exchange reaching a state through a
 * variable would be missed, and a variant nothing triggers is still a day the
 * scripts describe — which is what a lens is for. Two exclusions, both the
 * "excluded, never guessed" rule of slice 5: an NPC whose `id` is not a
 * literal is not in `npcIds` and gets no states, and a routine with no entries
 * the index could read is not offered, because choosing it would empty the
 * world with no explanation.
 *
 * The declared `daily_routine` is excluded — it is `routinesByNpc`'s answer,
 * and the picker's *Declared* default must not also appear as a state.
 */
export function routineStatesOf(
  npcIds: Readonly<Record<string, number>>,
  routinesByNpc: Readonly<Record<string, string>>,
  routineSites: readonly RoutineSite[]
): Record<string, { id: number; states: Record<string, string> }> {
  // Routine names are identifiers, so the id a name can end in is the digits
  // after its last underscore; bucketing by them keeps this linear.
  const routinesById = new Map<string, string[]>();
  for (const routine of new Set(routineSites.map((site) => site.routine))) {
    const id = /_(\d+)$/.exec(routine)?.[1];
    if (!routine.startsWith('RTN_') || id === undefined) continue;
    routinesById.set(id, [...(routinesById.get(id) ?? []), routine]);
  }

  const byNpc: Record<string, { id: number; states: Record<string, string> }> = {};
  for (const [npc, id] of Object.entries(npcIds)) {
    const suffix = `_${id}`;
    const states: Record<string, string> = {};
    for (const routine of routinesById.get(String(id)) ?? []) {
      if (routine === routinesByNpc[npc]) continue;
      const state = routine.slice('RTN_'.length, routine.length - suffix.length);
      if (state) states[state] = routine;
    }
    if (Object.keys(states).length > 0) byNpc[npc] = { id, states };
  }
  return byNpc;
}
