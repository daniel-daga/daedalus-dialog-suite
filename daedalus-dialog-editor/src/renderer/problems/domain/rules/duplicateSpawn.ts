import type { SpawnSite } from '../../../../shared/types';
import type { LintRule, Problem } from '../types';

/**
 * `duplicate-spawn`: one NPC is statically inserted at two different places, so
 * running both sites puts two copies of the same character in the world. This
 * is the "duplicate NPC IDs" cross-validation level-editor.md §8 names, over
 * the spawn index §16.19 slice 1 built.
 *
 * **Why it fires only for NPCs the project holds dialog for.** Measured over
 * retail Gothic II's 3,722 literal `Wld_InsertNpc` sites: 103 instances are
 * spawned at more than one distinct point, and nearly all of them are monster
 * templates — `Draconian` at 186 points, `Wolf` at 49 — which is the normal
 * shape of the game, not a finding. An instance is not enough to tell a
 * character from a template: monsters are `C_NPC` instances too, so the index's
 * `npcs` set holds all 961. Dialog is the editor's own definition of a
 * character, and restricting to it takes the same corpus from 103 findings to
 * **4** — Cavalorn, Gaan, Martin and Cord, each relocated by story progression
 * and each worth a look.
 *
 * The input is `dialogsByNpc` from the project index, not the parsed files'
 * facts, for the reason the waypoint rule takes its sites from the index: the
 * index rides `buildProjectIndex`'s worker-pool pass and sees every file, while
 * `parsedFiles` is capped and depends on what has been opened. An NPC the
 * project has no dialog for yields nothing — an empty index means nothing is
 * known, never that nothing is legal.
 *
 * Same instance at the *same* point twice is deliberately not this rule: 598 of
 * retail's site pairs do it (a pack of nine blattcrawlers on one waypoint), and
 * an NPC being in two *places* is the question here.
 */
export const duplicateSpawnRule: LintRule = (view): Problem[] => {
  if (view.dialogNpcKeys.size === 0) return [];

  const byInstance = new Map<string, SpawnSite[]>();
  for (const site of view.spawnSites) {
    const instance = site.instance.toUpperCase();
    if (!view.dialogNpcKeys.has(instance)) continue;
    const sites = byInstance.get(instance);
    if (sites) sites.push(site);
    else byInstance.set(instance, [site]);
  }

  const problems: Problem[] = [];

  for (const [instance, sites] of byInstance) {
    const points = [...new Set(sites.map((site) => site.spawnPoint.toUpperCase()))];
    if (points.length < 2) continue;

    // One problem per *site*, and a site is a file, a function and a point: a
    // function inserting the same NPC at the same place twice would otherwise
    // carry one id twice, which is what `ProblemsList` keys on.
    const seen = new Set<string>();
    for (const site of sites) {
      const point = site.spawnPoint.toUpperCase();
      const id = `duplicate-spawn:${site.filePath}:${site.functionName}:${instance}:${point}`;
      if (seen.has(id)) continue;
      seen.add(id);

      problems.push({
        id,
        rule: 'duplicate-spawn',
        severity: 'warning',
        message:
          `NPC "${instance}" is spawned at ${points.length} different points ` +
          `(${points.join(', ')}). This site spawns it at "${point}" — if more than ` +
          `one of them runs, the NPC exists more than once.`,
        locus: { kind: 'script', filePath: site.filePath, functionName: site.functionName }
      });
    }
  }

  return problems;
};
