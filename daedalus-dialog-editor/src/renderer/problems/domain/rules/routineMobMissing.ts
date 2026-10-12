import type { LintRule, Problem } from '../types';

type Vec3 = readonly [number, number, number];

/**
 * The open world's places a routine entry is judged against: its waypoints by
 * UPPERCASED name, and every mob with its scheme. Absent when no world is open,
 * which means nothing is known, never that nothing is legal.
 */
export interface RoutinePlacesView {
  waypoints: ReadonlyMap<string, Vec3>;
  mobs: readonly { scheme: string; position: Vec3 }[];
}

/**
 * `TA_*` → the schemes its state sits down at, read out of the retail scripts
 * by `zenkit-node/scripts/check-routine-mobs.js`: `TA.d` maps the TA to its
 * `ZS_*` through `TA_Min`, and that state's file calls
 * `AI_UseMob(self, "<SCHEME>", 1)`. Measured, not derived per project: a mod
 * that rewires a retail state gets a stale row here, which a hint can afford.
 */
const STATE_SCHEMES: Readonly<Record<string, readonly string[]>> = {
  TA_COOK_CAULDRON: ['CAULDRON'],
  TA_COOK_PAN: ['PAN'],
  TA_COOK_STOVE: ['STOVE'],
  TA_PICK_ORE: ['ORE'],
  TA_POTION_ALCHEMY: ['LAB'],
  TA_PRAY_INNOS: ['INNOS'],
  TA_PRAY_SLEEPER: ['IDOL'],
  TA_READ_BOOKSTAND: ['BOOK'],
  TA_REPAIR_HUT: ['REPAIR'],
  TA_ROAST_SCAVENGER: ['BARBQ'],
  TA_SAW: ['BAUMSAEGE'],
  TA_SIT_BENCH: ['BENCH'],
  TA_SIT_CHAIR: ['CHAIR'],
  TA_SIT_THRONE: ['THRONE'],
  TA_SLEEP: ['BEDHIGH'],
  TA_SLEEP_DEEP: ['BEDHIGH'],
  TA_SMITH_ANVIL: ['BSANVIL'],
  TA_SMITH_COOL: ['BSCOOL'],
  TA_SMITH_FIRE: ['BSFIRE'],
  TA_SMITH_SHARP: ['BSSHARP'],
  TA_SMOKE_WATERPIPE: ['SMOKE'],
  TA_STOMP_HERB: ['HERB'],
};

/** 20 m, in ZenGin centimetres: retail's near entries end at 12.3 m and its
 *  far ones start at 22.4 m (npc-editor.md §6 slice 7). */
const RADIUS = 2000;

/** Where retail parks an NPC that is out of play — 37 of its 80 far entries. */
const PARKING_WAYPOINT = 'TOT';

/** A mob's scheme, the way the engine matches one: its visual name up to the
 *  first `_` (`BEDHIGH_1_OC.ASC` → `BEDHIGH`). */
export const mobSchemeOf = (visual: string): string =>
  visual.toUpperCase().replace(/\.[A-Z0-9]+$/, '').split('_')[0];

const within = (a: Vec3, b: Vec3, radius: number): boolean =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 <= radius ** 2;

/**
 * `routine-mob-missing`: a routine entry whose state sits down at a mob, at a
 * waypoint with no mob of that scheme within 20 m (#318).
 *
 * A **hint**, never a warning: without its mob the state stands at the
 * waypoint, so a miss is cosmetic, and retail does it on purpose — 80 of its
 * 1,537 such entries are beyond 20 m, most of them dead NPCs posed with a
 * sleep or bench state. Maintainer, 2026-10-12.
 *
 * Reads the open world only. A waypoint the world lacks is
 * `waypoint-not-in-world`'s finding, and an entry in another world's routine
 * is unknowable here, so both say nothing.
 */
export const routineMobMissingRule: LintRule = (view): Problem[] => {
  const { routinePlaces, routineSites } = view;
  if (!routinePlaces) return [];

  const problems: Problem[] = [];
  for (const site of routineSites) {
    const schemes = site.stateName === undefined ? undefined : STATE_SCHEMES[site.stateName];
    if (schemes === undefined) continue;
    const waypoint = site.waypoint.toUpperCase();
    if (waypoint === PARKING_WAYPOINT) continue;
    const at = routinePlaces.waypoints.get(waypoint);
    if (at === undefined) continue;
    if (routinePlaces.mobs.some((mob) => schemes.includes(mob.scheme) && within(mob.position, at, RADIUS))) continue;

    problems.push({
      id: `routine-mob-missing:${site.filePath}:${site.line}`,
      rule: 'routine-mob-missing',
      severity: 'hint',
      message: `${site.stateName} at "${site.waypoint}" has no ${schemes.join(' or ')} within 20 m in the open world, `
        + 'so the NPC will stand there instead.',
      locus: { kind: 'script', filePath: site.filePath, functionName: site.routine, line: site.line },
    });
  }
  return problems;
};
