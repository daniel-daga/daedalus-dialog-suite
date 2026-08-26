#!/usr/bin/env node
/**
 * Drive the whole world pipeline against a real install (level-editor.md §3).
 *
 * The compiled `zenkit.worker` through the real `WorldService`, on a retail
 * world, with no test double and no spike code anywhere in the path. It is the
 * only instrument that exercises binding -> worker -> IPC -> payload end to
 * end, and it is developer-local for the same reason `zen-roundtrip` is: it
 * needs a Gothic install and the built native addon, which CI has neither of.
 *
 * It earns its place. Every unit test was green when `open` was transferring
 * the VOB index instead of copying it — which detached the worker's own
 * columns, so the first `visuals` call on the first real world died with
 * "Construct on a detached ArrayBuffer". Nothing but a run against real data
 * could see it, and that run took two minutes to write. The check is now
 * explicit below, so the bug cannot come back quietly.
 *
 *   npm run build:main                 # this reads dist/, not src/
 *   node scripts/verify-world-pipeline.js
 *   node scripts/verify-world-pipeline.js --world "<...>\OldWorld.zen"
 *
 * Prints the §3 table. Exits non-zero if the pipeline breaks or if a payload
 * comes back detached.
 */

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'main');
const { WorldService } = require(path.join(DIST, 'services', 'WorldService.js'));
const { gothicAssetSources } = require(path.join(__dirname, '..', '..', 'zen-world', 'dist', 'cjs', 'index.js'));

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const INSTALL = arg('install', process.env.GOTHIC2
  || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Gothic II');
const WORLD = arg('world', path.join(INSTALL, '_work', 'Data', 'Worlds', 'NewWorld', 'NewWorld.zen'));
const WORKER = path.join(DIST, 'workers', 'zenkit.worker.js');

const problems = [];
function check(condition, message) {
  if (!condition) problems.push(message);
}

async function main() {
  for (const [what, where] of [['install', INSTALL], ['world', WORLD], ['worker', WORKER]]) {
    if (!fs.existsSync(where)) {
      throw new Error(`No ${what} at ${where}${what === 'worker' ? ' — run `npm run build:main` first' : ''}`);
    }
  }

  // The same derivation the main process does, by `zen-world`'s measured rule:
  // archives where they exist, loose trees only as a fallback.
  const assetSources = gothicAssetSources(INSTALL.replace(/\\/g, '/'), fs.existsSync);
  console.log(`assets: ${assetSources.length} sources — ${assetSources.map((s) => path.basename(s)).join(', ')}`);
  check(assetSources.length > 0, `no Gothic assets found under ${INSTALL}`);

  const service = new WorldService({ workerPath: WORKER });
  const startedAt = Date.now();
  const summary = await service.openWorld({ worldPath: WORLD, gameVersion: 'g2', assetSources });
  const coldOpenMs = Date.now() - startedAt;

  const mesh = await service.getWorldMesh();
  const visuals = await service.getInstancedVisuals();

  // The regression this script exists for. `open` copies the VOB index and
  // transfers only the geometry, because `visuals` reads the index's columns to
  // decide what to place — transferring them detaches the worker's own copy.
  // A detached ArrayBuffer has byteLength 0, so the columns say it themselves.
  const index = summary.vobIndex;
  check(index.positions.byteLength > 0, 'the VOB index positions came back detached — `open` transferred the index');
  check(index.classIndex.byteLength > 0, 'the VOB index classIndex came back detached');
  check(index.visualIndex.byteLength > 0, 'the VOB index visualIndex came back detached');
  check(visuals.stats.vobsPlaced > 0, 'no VOB was placed — the index was unreadable by the time `visuals` ran');

  const instancedGroups = visuals.visuals.reduce((total, visual) => total + visual.groups.length, 0);
  const drawCalls = mesh.groups.length + instancedGroups;

  const textures = new Set();
  for (const group of mesh.groups) if (group.texture) textures.add(group.texture);
  for (const visual of visuals.visuals) {
    for (const group of visual.groups) if (group.texture) textures.add(group.texture);
  }

  // On demand, one at a time — the cold open no longer decodes all of them.
  const firstTexture = [...textures][0];
  const decodeStart = Date.now();
  const decoded = await service.getTexture(firstTexture, 256);
  const decodeMs = Date.now() - decodeStart;
  check(decoded !== null, `the first texture (${firstTexture}) did not decode`);

  const row = (label, value) => console.log(`  ${String(label).padEnd(34)}${value}`);
  console.log(`\n${path.basename(WORLD)} — the pipeline, end to end\n`);
  row('Materials -> world draw groups', `${summary.stats.materials} -> ${summary.stats.worldDrawGroups}`);
  row('World-mesh triangles', summary.stats.worldTriangles.toLocaleString());
  row('VOBs enumerated / placed', `${summary.stats.vobCount.toLocaleString()} / ${visuals.stats.vobsPlaced.toLocaleString()}`);
  row('Visuals seen / resolved', `${visuals.stats.visualsSeen} / ${visuals.stats.visualsResolved}`);
  row('Level compos skipped', visuals.stats.levelCompos);
  row('Instanced draw groups', `${instancedGroups}   (payload says ${visuals.stats.instancedDrawGroups})`);
  // Per VOB, not per visual name — 1,405 decal VOBs on NewWorld, not 23 decal
  // visuals. The per-name figure is `visualsSeen - visualsResolved`.
  row('Unresolved VOBs by type', Object.entries(visuals.stats.unresolvedByType)
    .map(([type, count]) => `${type} ${count}`).join(', ') || 'none');
  row('Unresolved visual names', visuals.stats.visualsSeen - visuals.stats.visualsResolved);
  row('Total draw calls', `${drawCalls}   (budget 1500)`);
  row('Unique textures', textures.size);
  row('Cold open', `${coldOpenMs} ms  incl. worker spawn`);
  row('  phases', Object.entries(summary.timings).map(([k, v]) => `${k} ${v}`).join(', '));
  row('One texture on demand', `${firstTexture} ${decoded ? `${decoded.width}x${decoded.height}` : 'FAILED'} in ${decodeMs} ms`);
  row('World bbox (ZenGin space)', summary.bbox.map((v) => Math.round(v)).join(', '));

  service.close();

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nPipeline OK.');
}

main().catch((error) => { console.error('FAILED:', error); process.exit(1); });
