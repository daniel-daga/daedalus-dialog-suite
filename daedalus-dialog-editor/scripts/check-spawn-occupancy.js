'use strict';

// How many NPCs does retail spawn on one waypoint? (level-editor.md §16.22,
// question 4.)
//
// §11 names an occupancy check among Phase 1c's deliverables and §16.22 holds
// it back for exactly this measurement: a threshold invented rather than
// counted would flag half of Khorinis as a crowd. §16.19 slice 2 already found
// the shape of the trap — 598 retail site pairs put the *same* instance on the
// *same* point on purpose, nine blattcrawlers on one waypoint — so occupancy
// has two numbers, not one: sites per point, and distinct instances per point.
//
// The corpus is a Daedalus script tree, so this rides the editor's own index:
// `extractFileMetadataFromSource` per file and `extractSpawnSites` over the
// models, which is the same pass `buildProjectIndex` runs. NPCs are told from
// items the way `ProjectService` tells them — an instance whose prototype chain
// reaches `C_NPC` — because `SpawnSite` keeps no class and both spawn externals
// feed it.
//
//   npm run build:main
//   node scripts/check-spawn-occupancy.js --project "<...>\mdk\Content"
//
// Developer-local: it needs a script corpus and a built `dist/main`. Nothing in
// CI runs it.

const fs = require('node:fs');
const path = require('node:path');

/**
 * Occupancy of every spawn point named by `spawnSites`: how many sites name it
 * and how many distinct instances those sites carry. The two histograms count
 * *points*, not sites, and are ascending in n; `busiest` is every point,
 * heaviest first, so a caller decides how much tail to print.
 */
function occupancyOf(spawnSites) {
  const byPoint = new Map(); // point -> { sites, instances: Set }

  for (const site of spawnSites) {
    let entry = byPoint.get(site.spawnPoint);
    if (!entry) {
      entry = { sites: 0, instances: new Set() };
      byPoint.set(site.spawnPoint, entry);
    }
    entry.sites += 1;
    entry.instances.add(site.instance);
  }

  const histogram = (valueOf) => {
    const counts = new Map();
    for (const entry of byPoint.values()) {
      const n = valueOf(entry);
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, points]) => ({ n, points }));
  };

  const busiest = [...byPoint.entries()]
    .map(([point, entry]) => ({ point, sites: entry.sites, instances: entry.instances.size }))
    .sort((a, b) => b.instances - a.instances || b.sites - a.sites || a.point.localeCompare(b.point));

  return {
    points: byPoint.size,
    sites: spawnSites.length,
    bySites: histogram((entry) => entry.sites),
    byInstances: histogram((entry) => entry.instances.size),
    busiest
  };
}

/**
 * Spawn calls written in a source, counted from the text. The index sees fewer:
 * `DialogFunction.callSites` carries only a function body's top-level calls, so
 * a `Wld_InsertNpc` inside an `if` body is invisible to `extractSpawnSites`
 * (measured 2026-08-29 — 1,178 of retail's 4,084). Reporting both is what keeps
 * the occupancy numbers from reading as the whole corpus.
 */
function countSpawnCalls(source) {
  return (source.match(/Wld_Insert(Npc|Item)\s*\(/gi) || []).length;
}

function parseArgs(argv) {
  let project = null;
  let top = 15;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') project = argv[i + 1];
    if (argv[i] === '--top') top = Number(argv[i + 1]);
  }
  if (!project) throw new Error('usage: check-spawn-occupancy.js --project <script tree> [--top n]');
  return { project, top };
}

function collectScripts(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.d')) files.push(full);
    }
  };
  walk(root);
  return files.sort();
}

/** `ProjectService`'s NPC test: an instance whose prototype chain reaches C_NPC. */
function npcInstanceNames(instances, prototypes) {
  const parentByType = new Map();
  for (const prototype of prototypes) {
    parentByType.set(prototype.name.trim().toUpperCase(), prototype.parent);
  }

  const reachesNpc = (parentName) => {
    const visited = new Set();
    let current = parentName;
    while (current) {
      const normalized = current.trim().toUpperCase();
      if (normalized === 'C_NPC') return true;
      if (visited.has(normalized)) return false;
      visited.add(normalized);
      current = parentByType.get(normalized) || '';
    }
    return false;
  };

  const npcs = new Set();
  for (const instance of instances) {
    if (reachesNpc(instance.parent)) npcs.add(instance.name.trim().toUpperCase());
  }
  return npcs;
}

function report(label, result, top) {
  const row = (name, value) => console.log(`  ${String(name).padEnd(30)}${value}`);
  console.log(`\n${label}\n`);
  row('spawn sites', result.sites);
  row('distinct spawn points', result.points);
  console.log('  sites on one point');
  for (const bin of result.bySites) row(`    ${bin.n}`, `${bin.points} points`);
  console.log('  distinct instances on one point');
  for (const bin of result.byInstances) row(`    ${bin.n}`, `${bin.points} points`);
  if (top > 0 && result.busiest.length) {
    console.log(`  busiest ${Math.min(top, result.busiest.length)}`);
    for (const entry of result.busiest.slice(0, top)) {
      console.log(`    ${entry.point.padEnd(28)}${entry.instances} instances, ${entry.sites} sites`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  // Built output, not source: `extractSpawnSites` is TypeScript in src/main.
  const metadata = require('../dist/main/utils/semanticMetadataUtils.js');

  const files = collectScripts(args.project);
  const fileModels = [];
  const instances = [];
  const prototypes = [];
  let failed = 0;
  let written = 0;

  for (const file of files) {
    try {
      // windows-1252 on disk; only ASCII identifiers matter to the count, and
      // latin1 never throws on a byte utf-8 would reject.
      const source = fs.readFileSync(file, 'latin1');
      written += countSpawnCalls(source);
      const result = metadata.extractFileMetadataFromSource(source, file);
      if (result.semanticModel) fileModels.push({ filePath: file, semanticModel: result.semanticModel });
      instances.push(...result.instances);
      prototypes.push(...result.prototypes);
    } catch {
      failed += 1;
    }
  }

  const sites = metadata.extractSpawnSites(fileModels);
  const npcs = npcInstanceNames(instances, prototypes);
  const npcSites = sites.filter((site) => npcs.has(site.instance));

  console.log(`\n${path.basename(args.project)} — spawn occupancy per waypoint\n`);
  console.log(`  ${files.length} .d files, ${fileModels.length} with a complete model, ${failed} failed to parse`);
  console.log(`  ${sites.length} of ${written} spawn calls reached the index (the rest are nested in if bodies)`);
  report('every static spawn (Wld_InsertNpc and Wld_InsertItem)', occupancyOf(sites), args.top);
  report('NPC spawns only', occupancyOf(npcSites), args.top);
}

module.exports = { countSpawnCalls, occupancyOf, npcInstanceNames };

if (require.main === module) main();
