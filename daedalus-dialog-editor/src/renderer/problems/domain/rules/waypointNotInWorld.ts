import type { LintRule, Problem } from '../types';

/**
 * `waypoint-not-in-world`: a script names a place the open world's waynet does
 * not have.
 *
 * Two inputs the other rules do not have, and both are optional for the same
 * reason. The sites come from the project index (`waypointSites`), which rides
 * the worker-pool pass and so sees every file; the names come from the world
 * currently open. **No world open means no findings** — the world is reference
 * data, and an absent one means nothing is known, never that nothing is legal.
 *
 * The answer this rule can give is deliberately the weaker of the two the
 * measurement found: 98.0 % of the corpus's literal sites resolve against all
 * 24 worlds but only 84.3 % against the three main ones, so a name absent here
 * is very often a perfectly good waypoint in another world. The editor holds
 * one world and no index of the others, so it says "not in this world" and can
 * never say "no such waypoint" (level-editor.md §16.8).
 *
 * Free points are prefix-matched because the engine matches them that way:
 * `"FP_ROAM"` reaches `FP_ROAM_CITY_01`. Exact matching would invent a finding
 * for every one of them.
 */
export const waypointNotInWorldRule: LintRule = (view): Problem[] => {
  const { world } = view;
  if (!world) return [];

  const problems: Problem[] = [];

  for (const [name, sites] of Object.entries(view.waypointSites)) {
    const upper = name.toUpperCase();
    if (world.pointNameKeys.has(upper)) continue;
    if (world.freePointNames.some((freePoint) => freePoint.startsWith(upper))) continue;

    // One problem per *site*, and a site is a file and a function: a routine
    // naming the same place twice is the normal Gothic shape, and the two
    // entries would carry one id, which is what `ProblemsList` keys on.
    const seen = new Set<string>();
    for (const site of sites) {
      const id = `waypoint-not-in-world:${site.filePath}:${site.functionName}:${upper}`;
      if (seen.has(id)) continue;
      seen.add(id);

      problems.push({
        id,
        rule: 'waypoint-not-in-world',
        severity: 'warning',
        message: `Waypoint "${name}" is not in the open world. It may belong to another world.`,
        filePath: site.filePath,
        functionName: site.functionName
      });
    }
  }

  return problems;
};
