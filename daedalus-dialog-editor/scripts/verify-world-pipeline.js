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
const {
  createVobReader, gothicAssetSources, moveVob, moveWaypoint,
} = require(path.join(__dirname, '..', '..', 'zen-world', 'dist', 'cjs', 'index.js'));

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

  await verifyOneEdit(service, index, visuals);
  await verifyWaypointEdit(service, index);

  service.close();

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nPipeline OK.');
}

/**
 * One edit, applied and undone against the real world (level-editor.md §7).
 *
 * Everything Phase 1a added is a read-only projection; an op is the first thing
 * that writes. What this proves, on real data: an op built from a real VOB
 * addresses a path the binding accepts (NewWorld's VOB 85 is at `2/71` — the
 * two numbering schemes visibly disagree, and a path built from the wrong one
 * would be refused or land elsewhere), the batch reaches the native world
 * without throwing, and the projection the viewport draws follows it there and
 * back through undo and redo.
 *
 * **What it does not prove, stated rather than implied:** that the native VOB
 * moved is the one the flat index named. The instance matrices are rebuilt from
 * the worker's *index*, which `applyOps` updates by flat index — so a path that
 * resolved to some other VOB would move that one natively while this check
 * still read a moved instance. Closing that needs the world saved and re-loaded,
 * which is Phase 1b's half of Gate 2 (acceptance record §8: rows 7-9 regain
 * their force on UI-edited worlds) and needs the writer, which no op touches yet.
 */
async function verifyOneEdit(service, index, visuals) {
  const reader = createVobReader(index);

  // A *nested* VOB deliberately: a root's path is one segment and would agree
  // with its flat index by construction, which is precisely the case that
  // proves nothing about the mapping between the two.
  let vob = -1;
  for (const visual of visuals.visuals) {
    for (const candidate of new Uint32Array(visual.vobIds)) {
      if (reader.columns.parent[candidate] >= 0) { vob = candidate; break; }
    }
    if (vob >= 0) break;
  }
  if (vob < 0) { check(false, 'no placed VOB with a parent to edit'); return; }
  const from = reader.position(vob);
  // Far enough that no float noise could account for it, in ZenGin centimetres.
  const op = moveVob(reader, vob, [from[0] + 500, from[1] + 500, from[2] + 500]);

  // Where the instance actually is, read back through the whole pipeline: the
  // worker rebuilds the matrices from its own index on every `visuals` call.
  const translationOf = async () => {
    const built = await service.getInstancedVisuals();
    for (const visual of built.visuals) {
      const ids = new Uint32Array(visual.vobIds);
      const at = ids.indexOf(vob);
      if (at === -1) continue;
      const matrices = new Float32Array(visual.matrices);
      return [matrices[at * 12 + 3], matrices[at * 12 + 7], matrices[at * 12 + 11]];
    }
    return null;
  };

  const near = (a, b) => a !== null && b !== null
    && a.every((value, i) => Math.abs(value - b[i]) < 0.5);

  const before = await translationOf();
  check(near(before, from), `the instance matrix does not agree with the index before any edit: ${before} vs ${from}`);

  await service.applyOps([op]);
  const moved = await translationOf();
  check(near(moved, op.to), `the VOB did not move: ${moved} vs ${op.to}`);

  check(await service.undo(), 'undo found nothing to undo');
  const restored = await translationOf();
  check(near(restored, from), `undo did not put the VOB back: ${restored} vs ${from}`);

  check(await service.redo(), 'redo found nothing to redo');
  check(near(await translationOf(), op.to), 'redo did not move the VOB again');
  check(await service.undo(), 'the second undo found nothing');

  const row = (label, value) => console.log(`  ${String(label).padEnd(34)}${value}`);
  console.log('\none edit, through the op path\n');
  row('VOB', `${vob} — ${reader.name(vob) || reader.visual(vob) || reader.className(vob)}`);
  row('Flat index -> index path', `${vob} -> ${op.path}`);
  row('Moved / undone / redone', `${from.map(Math.round).join(', ')} -> ${op.to.map(Math.round).join(', ')} -> back`);
}

/**
 * The same round trip for the first op that is not about a VOB.
 *
 * A waypoint's address is a bare index into the point list `getWaynet` emits,
 * with the name carried as a guard, so what this proves that no fixture can is
 * that the index the *renderer* reads and the index the *binding* writes are
 * the same number on a world with 23,288 VOBs and a real waynet — not on a
 * four-waypoint fixture where an off-by-one has nowhere to hide.
 *
 * It goes through `service.applyOps`, so it does **not** exercise
 * `assertApplyOpsRequest`; that layer's proof is `tests/ipcValidation.test.ts`,
 * and the two are not redundant. It also crosses the partition that keeps a
 * waynet op out of `applyOps` — a batch mixing one with a VOB move is the case
 * that used to commit the world and then throw on the projection.
 */
async function verifyWaypointEdit(service, index) {
  const waynet = await service.getWaynet();
  const names = waynet.names;
  if (names.length === 0) { check(false, 'the world has no waypoints to edit'); return; }

  // Not waypoint 0: the first entry's index agrees with every plausible
  // off-by-one and with an unfiltered list, so it is the one address that
  // proves nothing.
  const waypoint = Math.min(7, names.length - 1);
  const positions = new Float32Array(waynet.positions);
  const op = moveWaypoint(positions, names, waypoint, [
    positions[waypoint * 3] + 500,
    positions[waypoint * 3 + 1] + 500,
    positions[waypoint * 3 + 2] + 500,
  ]);

  // Read back through the whole pipeline, not out of the payload we just used:
  // the worker calls `getWaynet` fresh every time and caches nothing.
  const positionOf = async () => {
    const fresh = await service.getWaynet();
    const at = fresh.names.indexOf(op.name);
    if (at === -1) return null;
    const column = new Float32Array(fresh.positions);
    return [column[at * 3], column[at * 3 + 1], column[at * 3 + 2]];
  };
  const near = (a, b) => a !== null && b !== null
    && a.every((value, i) => Math.abs(value - b[i]) < 0.5);

  check(near(await positionOf(), op.from), 'the waynet payload disagrees with itself before any edit');

  // Mixed with a VOB move on purpose: neither op renumbers, so they may share a
  // batch, and the partition is only exercised when one actually does.
  const reader = createVobReader(index);
  const vobFrom = reader.position(0);
  await service.applyOps([op, moveVob(reader, 0, [vobFrom[0] + 100, vobFrom[1], vobFrom[2]])]);
  check(near(await positionOf(), op.to), 'the waypoint did not move');

  check(await service.undo(), 'undo found nothing to undo');
  check(near(await positionOf(), op.from), 'undo did not put the waypoint back');

  check(await service.redo(), 'redo found nothing to redo');
  check(near(await positionOf(), op.to), 'redo did not move the waypoint again');
  check(await service.undo(), 'the second undo found nothing');
  check(near(await positionOf(), op.from), 'the world was left with the waypoint moved');

  const row = (label, value) => console.log(`  ${String(label).padEnd(34)}${value}`);
  console.log('\none waypoint edit, batched with a VOB move\n');
  row('Waypoint', `${waypoint} of ${names.length} — ${op.name}`);
  row('Moved / undone / redone', `${op.from.map(Math.round).join(', ')} -> ${op.to.map(Math.round).join(', ')} -> back`);
}

main().catch((error) => { console.error('FAILED:', error); process.exit(1); });
