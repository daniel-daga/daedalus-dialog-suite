import type { SpawnSite } from '../../shared/types';
import { worldHasPoint, type WorldWaynetView } from '../problems/domain/types';

/**
 * The NPC/Dialog side of the world jump `InsertNpcActionRenderer` already has
 * (§16.23 W4) — a dialog names an NPC, not a spawn point, so this is the one
 * extra step: resolve the instance to the spawn point the project index
 * already knows for it, then hand off to the same `worldHasPoint` disabled
 * reasons so the two jump buttons cannot disagree about what is missing.
 *
 * `Wld_InsertNpc` is where the corpus keeps most spawns, and `spawnSites` is
 * built from every literal call of it project-wide — so this answers for an
 * NPC even when the dialog open right now is not the file that spawns them.
 */

/**
 * The instance's static spawn site, or `null` when the project index has none
 * for it. First match only: an NPC spawned twice (a rare, usually unreachable
 * script) still has to resolve to one point, and the panel — not this button —
 * is where every site of an NPC belongs (§16.19 slice 9 decision 4's "who"
 * reasoning applies here too).
 *
 * Daedalus is case-insensitive and `SpawnSite.instance` is UPPERCASED at
 * extraction; `npc` is matched the same way so a dialog's own casing of the
 * name never causes a miss.
 */
export function resolveNpcSpawnSite(spawnSites: readonly SpawnSite[], npc: string): SpawnSite | null {
  const upper = npc.toUpperCase();
  return spawnSites.find((candidate) => candidate.instance.toUpperCase() === upper) ?? null;
}

/** The site's spawn point alone, for callers that never need the rest of it. */
export function resolveNpcSpawnPoint(spawnSites: readonly SpawnSite[], npc: string): string | null {
  return resolveNpcSpawnSite(spawnSites, npc)?.spawnPoint ?? null;
}

/**
 * Which world a spawn site's function names, by the engine's own convention:
 * it spawns every NPC from a function named after the world *file* —
 * `STARTUP_NEWWORLD`, `STARTUP_DRAGONISLAND`, `INIT_…` likewise
 * (`environment-hazards.md`, *"A candidate is only a game under the name
 * NEWWORLD.ZEN"*). `null` for a function that does not follow it — a helper
 * some scripts wrap `Wld_InsertNpc` in, say — because a guess dressed as a
 * fact is worse than the plain "no world open" it would replace.
 */
export function expectedWorldNameFor(functionName: string): string | null {
  const match = /^(?:STARTUP|INIT)_(.+)$/i.exec(functionName);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Why the jump is disabled, or `null` when it isn't — the same three-answer
 * shape §16.8 named for the action-level button, with one more rung above it:
 * a dialog can also name no NPC, and an NPC the index has never seen spawned
 * is a different fact from a spawn point missing from *this* world.
 *
 * `expectedWorldName` only sharpens the wording of the "no world" and "wrong
 * world" reasons — it names the `.ZEN` the spawn site's own function points
 * to, when `expectedWorldNameFor` could read one off it. It answers no new
 * question and opens nothing itself: resolving that name to a path, and
 * actually opening it, needs a world-directory setting this button does not
 * have (level-editor.md §16.19 slice 14's closing paragraph).
 */
export function npcJumpReason(
  npc: string | null,
  spawnPoint: string | null,
  world: WorldWaynetView | null,
  expectedWorldName: string | null = null,
): string | null {
  if (!npc) return 'This dialog names no NPC';
  if (!spawnPoint) return `No spawn point is known for ${npc}`;
  if (world === null) {
    return expectedWorldName ? `Open ${expectedWorldName}.ZEN to jump here` : 'No world is open';
  }
  if (!worldHasPoint(world, spawnPoint)) {
    return expectedWorldName
      ? `${spawnPoint} is not in the open world — open ${expectedWorldName}.ZEN`
      : `${spawnPoint} is not in the open world`;
  }
  return null;
}
