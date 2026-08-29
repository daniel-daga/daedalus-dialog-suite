'use strict';
// Builds the candidate worlds for the T10 / E-full engine pass
// (docs/engine-acceptance-2026-08-25.md §8), into a directory
// `tools/engine-batch.ps1 -Dir <abs path>` can run:
//
//   00-control-original.zen   the pristine retail world (the control)
//   01-resave.zen             load → save, unchanged (checklist rows 2–9)
//   02-minimal-edit.zen       the two Phase-0 mutations (row 10)
//
// Candidate `03` was built 2026-08-27 and seven ops have landed since, so these
// three cover what no engine has seen (§16.2). One candidate per failure domain,
// so a bad row localizes instead of implicating the whole op set:
//
//   03-class-props.zen        SetVobClassProp and SetVobProp's new keys — the
//                             edits whose ONLY witness is the engine
//   04-authored-classes.zen   AddVob for the classes I1–I5 taught it to build
//   05-deletes-waynet.zen     DeleteVob on a subtree, and all five waynet ops
//   06-minimal-frame.zen      the same edits in a frame they can be SEEN in —
//                             built 2026-08-28, after 03-05 loaded clean and
//                             were observed hardly at all
//   07a/07b/07c.zen           `05`'s own two observation rows, in `06`'s shape
//                             — built 2026-08-29, the last thing that sheet
//                             leaves unwitnessed (§16.2)
//
// Each of 03–05 is built from the pristine source, not from the one before it:
// a candidate that stacked would report the first failure and hide the rest.
//
// engine-batch.ps1 picks up `*.zen` in that directory, sorted by name, and
// installs each as NewWorld.zen in turn.
//
// Never report a result without its control: Spacer renders nothing on the FIRST
// load of ANY world, the retail original included. Load each world twice, and
// A/B against `00` in the same session.
//
// Usage: node tools/mutate.js <outDir> [<NewWorld.zen>]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const zk = require('..');

// The pristine source is the corpus `scripts/extract-worlds.js` pulls out of
// the retail archives — never a file inside the install, which the GMBT
// harness leaves stock.
const outDir = process.argv[2];
if (!outDir) throw new Error('usage: node tools/mutate.js <outDir> [<NewWorld.zen>]');
const src = process.argv[3] || path.join(__dirname, '..', 'worlds', 'NEWWORLD.ZEN');

// The two Phase-0 mutations, exactly as §8 records them.
const MOVED_VOB = '2/962';   // NW_CITY_TABLE_PEASANT_01.3DS, nearest visual VOB to START
const LIFT_Y = 300;          // engine units, straight up: it should visibly hang in the air
const ITEM_ABOVE_START = 80; // an apple at the hero's feet on a new game

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

fs.mkdirSync(outDir, { recursive: true });
const stage = (name) => path.join(outDir, `${name}.zen`);

console.log(`source: ${src}\n        ${sha(src)}`);

const control = stage('00-control-original');
fs.copyFileSync(src, control);

const resave = stage('01-resave');
zk.saveWorld(zk.loadWorld(src, 'g2'), resave);

const edited = stage('02-minimal-edit');
{
  const handle = zk.loadWorld(src, 'g2');
  const before = zk.normalizeWorld(handle);
  const vob = before.vobs.find((v) => v.path === MOVED_VOB);
  if (!vob) throw new Error(`no VOB at ${MOVED_VOB}`);
  const start = before.waynet.waypoints.find((w) => w.name === 'START');
  if (!start) throw new Error('no START waypoint');

  const moved = [vob.position[0], vob.position[1] + LIFT_Y, vob.position[2]];
  zk.setVobPosition(handle, MOVED_VOB, moved);
  const itemPath = zk.insertVob(handle, null, {
    class: 'oCItem',
    name: 'ITEM_PHASE0_APPLE_01',
    instance: 'ITFO_APPLE',
    position: [start.position[0], start.position[1] + ITEM_ABOVE_START, start.position[2]],
  });
  zk.saveWorld(handle, edited);

  console.log(`\nmoved   ${MOVED_VOB} ${vob.class} "${vob.visual}"`);
  console.log(`        ${vob.position.join(', ')}  ->  ${moved.join(', ')}`);
  console.log(`inserted ${itemPath} oCItem ITFO_APPLE "ITEM_PHASE0_APPLE_01"`);
  console.log(`        ${ITEM_ABOVE_START} above START (${start.position.join(', ')})`);
  console.log(`vobs    ${before.vobs.length} -> ${zk.normalizeWorld(zk.loadWorld(edited, 'g2')).vobs.length}`);
}

// ---------------------------------------------------------------------------
// The ops candidate `03` never saw. Every address below was measured against
// this world on 2026-08-28, and each is asserted rather than assumed: a silently
// missing VOB would produce a candidate that tests nothing and still passes.
// ---------------------------------------------------------------------------

const FOG_ZONE = '2/597';        // the only zCZoneZFog near START
const TORCH_SOUND = '2/1266';    // TORCH_BURN, radius 600
const MUSIC_ZONES = ['2/37', '2/38', '2/39'];  // XARDAS_XAR, volume 1
const SHADOW_VOB = '2/70';       // NW_NATURE_STONE_BIGFLAT_02.3DS, a big flat rock
const TORCH_SUBTREE = '2/1248';  // a wall torch with 5 children: flare, 2 lights, 2 pfx
// Waynet indices are `getWaynet`'s, NOT `normalizeWorld`'s — the two orders
// differ, and measuring against the wrong one addresses a waypoint on the far
// side of the map. The index+name guard is what catches it; do not weaken it.
const DELETE_WP = { index: 63, name: 'NW_XARDAS_TOWER_IN1_32' }; // leaf, named by no script
const EDGE_A = { index: 62, name: 'NW_XARDAS_TOWER_IN1_25' };
const EDGE_B = { index: 68, name: 'NW_XARDAS_TOWER_IN1_26' };

const at = (dump, p) => {
  const vob = dump.vobs.find((v) => v.path === p);
  if (!vob) throw new Error(`no VOB at ${p} — re-measure before trusting this candidate`);
  return vob;
};

const classProps = stage('03-class-props');
{
  const handle = zk.loadWorld(src, 'g2');
  const before = zk.normalizeWorld(handle);

  // A fog zone written wrongly is invisible in the viewport — §16.2's sharpest
  // gap. Red and close is chosen to be unmistakable from the control.
  at(before, FOG_ZONE);
  zk.setVobClassProp(handle, FOG_ZONE, {
    rangeCenter: 4000, overrideColor: true, color: [255, 32, 32, 255],
  });

  // Audible from across the clearing instead of only at the torch.
  at(before, TORCH_SOUND);
  zk.setVobClassProp(handle, TORCH_SOUND, { radius: 5000 });

  // All three, or the two untouched ones would mask the changed one.
  for (const zone of MUSIC_ZONES) {
    at(before, zone);
    zk.setVobClassProp(handle, zone, { volume: 0.15 });
  }

  // V1/V2 keys. Not visually decisive on their own — the claim they carry is
  // that a world written with them still loads and still behaves.
  at(before, SHADOW_VOB);
  zk.setVobProp(handle, SHADOW_VOB, {
    dynamicShadows: 1, presetName: 'GATE2B_PRESET', visualCamAlign: 0, bias: 1,
  });

  zk.saveWorld(handle, classProps);
  console.log(`\n03  fog ${FOG_ZONE} red @4000, sound ${TORCH_SOUND} r=5000,`);
  console.log(`    music ${MUSIC_ZONES.join(',')} vol=0.15, ${SHADOW_VOB} dynamicShadows+preset+bias`);
}

const authored = stage('04-authored-classes');
{
  const handle = zk.loadWorld(src, 'g2');
  const before = zk.normalizeWorld(handle);
  const start = before.waynet.waypoints.find((w) => w.name === 'START');
  const near = (dx, dy, dz) => [
    start.position[0] + dx, start.position[1] + dy, start.position[2] + dz,
  ];

  // An openable chest is row 7 for a VOB the editor made rather than one retail
  // placed. Unlocked deliberately: a locked one needs a key or pick string the
  // catalogue cannot author, so it would be unopenable rather than a test.
  const chest = zk.insertVob(handle, null, {
    class: 'oCMobContainer', name: 'GATE2B_CHEST',
    visual: 'CHESTBIG_NW_NORMAL_OPEN.MDS', position: near(200, 0, 200),
  });
  zk.setVobClassProp(handle, chest, { locked: false });

  // Magenta so it cannot be confused with any retail light in the tower.
  const light = zk.insertVob(handle, null, {
    class: 'zCVobLight', name: 'GATE2B_LIGHT', position: near(-200, 150, 200),
  });
  zk.setVobClassProp(handle, light, { range: 1500, color: [255, 0, 255, 255] });

  // A placed sound is silent until its name is set — AddVob and
  // SetVobClassProp tested as the pair a user actually performs.
  const sound = zk.insertVob(handle, null, {
    class: 'zCVobSound', name: 'GATE2B_SOUND', position: near(0, 100, 300),
  });
  zk.setVobClassProp(handle, sound, { soundName: 'TORCH_BURN', radius: 2000, volume: 100 });

  // LIGHTCONE.PFX is in this world already, so a missing effect is our writer
  // and not a missing asset.
  const pfx = zk.insertVob(handle, null, {
    class: 'zCPFXController', name: 'GATE2B_PFX', position: near(200, 100, -200),
  });
  zk.setVobClassProp(handle, pfx, { pfxName: 'LIGHTCONE.PFX', initiallyRunning: true });

  // These four carry no reachable `target` (§16.15), so the claim is only that
  // the world still loads and still behaves with them in it.
  const quiet = [
    ['zCTrigger', 'GATE2B_TRIGGER', near(-300, 0, -200), ''],
    ['zCMover', 'GATE2B_MOVER', near(300, 0, 0), 'NW_CRATE.3DS'],
    ['oCMobDoor', 'GATE2B_DOOR', near(-300, 0, 0), 'DOOR_WOODEN.MDS'],
    ['oCZoneMusic', 'XARDAS_XAR', near(0, 0, -300), ''],
  ];
  for (const [cls, name, position, visual] of quiet) {
    zk.insertVob(handle, null, { class: cls, name, position, ...(visual ? { visual } : {}) });
  }

  zk.saveWorld(handle, authored);
  console.log(`\n04  chest ${chest}, light ${light}, sound ${sound}, pfx ${pfx}`);
  console.log(`    plus ${quiet.map((q) => q[0]).join(', ')} placed for load-safety`);
  console.log(`    vobs ${before.vobs.length} -> ${zk.normalizeWorld(zk.loadWorld(authored, 'g2')).vobs.length}`);
}

const deletes = stage('05-deletes-waynet');
{
  const handle = zk.loadWorld(src, 'g2');
  const before = zk.normalizeWorld(handle);
  const wpBefore = before.waynet.waypoints.length;

  // The subtree delete §16.2 calls the edit ZenGin has the most room to
  // disagree about: a lit wall torch, whose five children are a lens flare, two
  // lights and two particle effects. All six must go, and visibly.
  const torch = at(before, TORCH_SUBTREE);
  const kids = before.vobs.filter((v) => v.path.startsWith(`${TORCH_SUBTREE}/`)).length;
  if (kids < 5) throw new Error(`${TORCH_SUBTREE} has ${kids} children, expected 5`);
  zk.deleteVob(handle, TORCH_SUBTREE);

  // Our own waypoint first: appended, so every index measured above is still
  // valid until the arbitrary delete at the end.
  const start = before.waynet.waypoints.find((w) => w.name === 'START');
  const added = zk.addWaypoint(handle, 'GATE2B_WP', [
    start.position[0] + 400, start.position[1], start.position[2] + 400,
  ]);
  zk.addWaypointEdge(handle, added, 'GATE2B_WP', EDGE_A.index, EDGE_A.name);
  zk.addWaypointEdge(handle, added, 'GATE2B_WP', EDGE_B.index, EDGE_B.name);
  zk.setWaypointName(handle, added, 'GATE2B_WP', 'GATE2B_WP_RENAMED');
  zk.setWaypointPosition(handle, added, 'GATE2B_WP_RENAMED', [
    start.position[0] + 600, start.position[1], start.position[2] + 400,
  ]);
  // One edge removed, one kept: the removal is tested and the survivor proves
  // an authored edge reaches the file.
  zk.removeWaypointEdge(handle, added, 'GATE2B_WP_RENAMED', EDGE_B.index, EDGE_B.name);

  // Last, because it renumbers everything after it. A leaf no script names, so
  // a broken NPC route would be our writer and not a broken routine.
  zk.removeWaypoint(handle, DELETE_WP.index, DELETE_WP.name, true);

  zk.saveWorld(handle, deletes);
  const after = zk.normalizeWorld(zk.loadWorld(deletes, 'g2'));
  console.log(`\n05  deleted ${TORCH_SUBTREE} "${torch.visual}" + ${kids} children`);
  console.log(`    added GATE2B_WP -> renamed -> moved, 2 edges then 1 removed`);
  console.log(`    removed waypoint ${DELETE_WP.index} ${DELETE_WP.name} (renumbers ${wpBefore - DELETE_WP.index - 1})`);
  console.log(`    vobs ${before.vobs.length} -> ${after.vobs.length}, waypoints ${wpBefore} -> ${after.waynet.waypoints.length}`);
}

// ---------------------------------------------------------------------------
// 06 — the minimal-frame candidate (2026-08-28).
//
// Gate 2b's load-time half passed and its *observation* half did not: the fog
// zone was indistinguishable from NewWorld's ambient fog, the sound radius and
// the music volumes were not judgeable by ear, and the authored chest was never
// found. None of that was the ops' fault — retail NewWorld is simply the wrong
// instrument, because an A/B by eye needs the edit to be the only thing in the
// frame (§16.2).
//
// A genuinely minimal *world* is not reachable: the game boots NewWorld through
// a script layer that spawns every NPC at `NW_*` waypoints, so swapping the file
// for a small authored world breaks the scripts rather than the scenery. What is
// reachable is a minimal *frame* — clear the noise out of the spawn's
// neighbourhood, then put the edits under test where the hero is already
// looking. Everything beyond the radius is untouched, so distant routines,
// mobsis and sounds still behave and a failure still localizes.
// ---------------------------------------------------------------------------

// Everything within this of START that only makes light or noise. 6,000 units is
// wider than the 5,000-unit sound radius `03` used, so nothing retail is left
// inside the frame to mask the one sound under test.
const QUIET_RADIUS = 6000;
const NOISE_CLASSES = new Set([
  'zCVobLight', 'zCVobSound', 'zCVobSoundDaytime', 'zCPFXController',
]);
// `oCMobFire` is deliberately NOT in that set: a fire is an interactive mob a
// routine can name, and its light and particle children are separate VOBs of
// the classes above, so they go without taking the mob with them.

const FOG_HALF = 4000;      // half-extent of the authored fog zone's box
const FOG_RANGE_CENTER = 3000;  // thick enough to read as red, open enough to see 250 units
const CHEST_AHEAD = 250;    // along START's own direction — the hero faces it
const LIGHT_ABOVE = 200;
const SOUND_AT = 3000;      // the sound VOB's distance from the spawn...
const SOUND_RADIUS = 8000;  // ...and the radius that has to be written for it to carry

// The engine's crosshair finds a mob through `focusName`, and a mob without one
// is placeable, visible and impossible to use. Retail agrees per class rather
// than globally — 220 of 225 containers say `MOBNAME_CHEST`, while 7 beds and
// 121 fires say nothing at all, because those are used by NPC routines and not
// by the player's hand. So it is set here and not defaulted in the binding.
const CHEST_FOCUS = 'MOBNAME_CHEST';

/**
 * The highest world-mesh triangle under (x, z) and below `fromY`.
 *
 * A VOB placed at the spawn's own Y hangs in the air as soon as the ground
 * slopes away, which is what the first `06` run saw. There is no raycast in the
 * binding — the editor's `raycastDown` is three.js in the renderer — so this
 * walks the mesh once. One point query over NewWorld's triangles, not a loop.
 */
const groundBelow = (mesh, x, z, fromY) => {
  let best = -Infinity;
  for (const chunk of mesh.chunks) {
    const p = new Float32Array(chunk.positions);
    const idx = new Uint32Array(chunk.indices);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3; const b = idx[i + 1] * 3; const c = idx[i + 2] * 3;
      const ax = p[a]; const az = p[a + 2];
      const bx = p[b]; const bz = p[b + 2];
      const cx = p[c]; const cz = p[c + 2];
      // Barycentric containment in the XZ plane.
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (d === 0) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      if (u < 0 || u > 1) continue;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (v < 0 || u + v > 1) continue;
      const y = u * p[a + 1] + v * p[b + 1] + (1 - u - v) * p[c + 1];
      if (y <= fromY && y > best) best = y;
    }
  }
  return best;
};

// Reverse depth-first order: deleting a VOB shifts only the paths *after* it, so
// working backwards keeps every path still to be deleted valid. Children sort
// after their parent, so a subtree is emptied before its root is removed.
const byPathDesc = (a, b) => {
  const x = a.split('/').map(Number);
  const y = b.split('/').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (y[i] ?? -1) - (x[i] ?? -1);
    if (d) return d;
  }
  return 0;
};

const minimal = stage('06-minimal-frame');
{
  const handle = zk.loadWorld(src, 'g2');
  const before = zk.normalizeWorld(handle);
  const start = before.waynet.waypoints.find((w) => w.name === 'START');
  if (!start) throw new Error('no START waypoint');
  const [sx, sy, sz] = start.position;

  // "In front of the spawn" is the waypoint's own direction, which is where the
  // hero faces on a new game. Guessing an axis is what put `04`'s chest in a
  // forest the run never searched.
  const d = start.direction;
  const len = Math.hypot(d[0], d[2]);
  if (len < 1e-3) throw new Error('START has no usable direction — re-measure before trusting this candidate');
  const ahead = (n) => [sx + (d[0] / len) * n, sy, sz + (d[2] / len) * n];

  const near = (v) => Math.hypot(v.position[0] - sx, v.position[1] - sy, v.position[2] - sz) <= QUIET_RADIUS;
  // Every fog zone in the world, not only the near ones: a zone's *position*
  // says nothing about the volume its box covers, so a distant one can still be
  // the one the spawn stands in. The world's own `zCZoneZFogDefault` is not a
  // placed VOB and survives, which is what keeps the control looking normal.
  const doomed = before.vobs
    .filter((v) => v.class === 'zCZoneZFog' || (NOISE_CLASSES.has(v.class) && near(v)))
    .map((v) => v.path)
    .sort(byPathDesc);
  if (doomed.length < 10) throw new Error(`only ${doomed.length} VOBs to clear — re-measure, the frame is not being cleared`);
  for (const p of doomed) zk.deleteVob(handle, p);

  // The sharpest gap in §16.2, given a frame it can actually be seen in: an
  // authored zone, its own box around the spawn, red and overriding. Both ops in
  // one row — AddVob builds the zone, SetVobClassProp is the only thing that
  // makes it red.
  const fog = zk.insertVob(handle, null, {
    class: 'zCZoneZFog', name: 'GATE2B_MIN_FOG', position: [sx, sy, sz],
    bbox: [sx - FOG_HALF, sy - FOG_HALF, sz - FOG_HALF, sx + FOG_HALF, sy + FOG_HALF, sz + FOG_HALF],
  });
  zk.setVobClassProp(handle, fog, {
    rangeCenter: FOG_RANGE_CENTER, innerRangePercentage: 0.3,
    fadeOutSky: true, overrideColor: true, color: [255, 0, 0, 255],
  });

  // Radius, tested as a binary rather than as a loudness: the VOB sits 3,000
  // units away in a frame with no other sound in it, so it is audible at the
  // spawn only if the radius reached the file.
  const sound = zk.insertVob(handle, null, {
    class: 'zCVobSound', name: 'GATE2B_MIN_SOUND', position: ahead(SOUND_AT),
  });
  zk.setVobClassProp(handle, sound, {
    soundName: 'TORCH_BURN', radius: SOUND_RADIUS, volume: 100, initiallyPlaying: true,
  });

  // `04`'s chest, at arm's length and dead ahead instead of 280 units off into
  // the trees. It still has to open — that is row 7 for a VOB the editor made.
  //
  // The box is measured off a retail container carrying the same visual rather
  // than left to default: the default is a 10 cm cube around the position, the
  // engine culls by box, and this candidate exists to stop losing this row to
  // something other than the op under test.
  const CHEST_VISUAL = 'CHESTBIG_NW_NORMAL_OPEN.MDS';
  const model = before.vobs.find((v) => v.class === 'oCMobContainer' && v.visual === CHEST_VISUAL);
  if (!model) throw new Error(`no retail oCMobContainer with ${CHEST_VISUAL} to measure a box from`);
  const rel = model.bbox.map((n, i) => n - model.position[i % 3]);
  const chestPos = ahead(CHEST_AHEAD);
  // Stand it on the ground rather than at the spawn's height: the terrain slopes
  // away over those 250 units, and the first run of this candidate saw the chest
  // hanging in the air. `+ 512` starts the ray above the spawn so a rise is
  // caught as well as a fall.
  const ground = groundBelow(zk.extractWorldMesh(handle), chestPos[0], chestPos[2], sy + 512);
  if (!Number.isFinite(ground)) throw new Error('no world-mesh ground under the chest — re-measure the placement');
  if (Math.abs(ground - sy) > 400) throw new Error(`ground under the chest is ${(ground - sy).toFixed(0)} from the spawn — that is not the clearing`);
  chestPos[1] = ground;
  const chest = zk.insertVob(handle, null, {
    class: 'oCMobContainer', name: 'GATE2B_MIN_CHEST',
    visual: CHEST_VISUAL, position: chestPos,
    bbox: rel.map((n, i) => n + chestPos[i % 3]),
  });
  // `locked` was the row; `focusName` is what makes the row reachable at all.
  zk.setVobClassProp(handle, chest, { locked: false, focusName: CHEST_FOCUS });

  // Confirmed already in Gate 2b, and kept for a second job: the frame's own
  // lights were just deleted, so this is what the chest is lit by.
  const light = zk.insertVob(handle, null, {
    class: 'zCVobLight', name: 'GATE2B_MIN_LIGHT', position: [sx, sy + LIGHT_ABOVE, sz],
  });
  zk.setVobClassProp(handle, light, { range: 2000, color: [255, 0, 255, 255] });

  zk.saveWorld(handle, minimal);

  // Asserted on reload, not assumed — a candidate that tests nothing and still
  // passes is the failure mode this whole file exists to avoid.
  const rh = zk.loadWorld(minimal, 'g2');
  const after = zk.normalizeWorld(rh);
  const find = (name) => {
    const v = after.vobs.find((x) => x.name === name);
    if (!v) throw new Error(`${name} is not in the saved world`);
    return v;
  };
  const zones = after.vobs.filter((v) => v.class === 'zCZoneZFog');
  if (zones.length !== 1 || zones[0].name !== 'GATE2B_MIN_FOG') {
    throw new Error(`${zones.length} fog zones survived, expected exactly ours`);
  }
  const left = after.vobs.filter((v) => NOISE_CLASSES.has(v.class)
    && Math.hypot(v.position[0] - sx, v.position[1] - sy, v.position[2] - sz) <= QUIET_RADIUS
    && !v.name.startsWith('GATE2B_MIN_'));
  if (left.length) throw new Error(`${left.length} light/sound VOBs left inside the frame, e.g. ${left[0].path} ${left[0].class}`);

  const fogProps = zk.getVobProps(rh, find('GATE2B_MIN_FOG').path);
  if (!fogProps.overrideColor || fogProps.rangeCenter !== FOG_RANGE_CENTER) {
    throw new Error(`fog zone read back wrong: ${JSON.stringify(fogProps)}`);
  }
  const soundProps = zk.getVobProps(rh, find('GATE2B_MIN_SOUND').path);
  if (soundProps.radius !== SOUND_RADIUS || soundProps.soundName !== 'TORCH_BURN') {
    throw new Error(`sound read back wrong: ${JSON.stringify(soundProps)}`);
  }
  const chestBack = find('GATE2B_MIN_CHEST');
  const chestProps = zk.getVobProps(rh, chestBack.path);
  if (chestProps.locked !== false) throw new Error(`chest read back locked: ${JSON.stringify(chestProps)}`);
  // The four ways this one row has already been lost without anything failing.
  if (chestProps.focusName !== CHEST_FOCUS) throw new Error('the chest has no focus name — the engine cannot target it');
  if (chestBack.flags.showVisual !== true) throw new Error('the chest does not claim to draw');
  if (chestBack.bbox[3] - chestBack.bbox[0] < 50) {
    throw new Error(`the chest's box is ${chestBack.bbox[3] - chestBack.bbox[0]} wide — the default, not the measured one`);
  }

  console.log(`\n06  cleared ${doomed.length} light/sound/pfx/fog VOBs within ${QUIET_RADIUS} of START`);
  console.log(`    fog ${fog} red @${FOG_RANGE_CENTER}, box +-${FOG_HALF} around the spawn`);
  console.log(`    sound ${sound} TORCH_BURN r=${SOUND_RADIUS} at ${SOUND_AT} ahead`);
  console.log(`    chest ${chest} at ${CHEST_AHEAD} ahead, light ${light} magenta overhead`);
  console.log(`    vobs ${before.vobs.length} -> ${after.vobs.length}`);
}

// ---------------------------------------------------------------------------
// 07 — `05`'s two observation rows, in a frame they can be seen in (2026-08-29).
//
// `05` came back "loads and plays" and nothing else: retail NewWorld has ~196
// lights and 37 sounds inside the spawn's neighbourhood, so a torch that went
// missing changed a frame nobody could read, and the waypoint renumber was
// never watched at all. `06` proved the instrument works. These three are the
// same instrument pointed at the two rows it has not answered (§16.2).
//
// Three files, because the rows want different experiments:
//
//   07a  the frame cleared of every light, sound and effect within 6,000 units
//        of START **except the torch subtree** — which leaves exactly one lit,
//        crackling thing in an otherwise dead clearing. Nothing is deleted.
//        This is row A's control, and `00` cannot be it: in retail the torch is
//        one of two hundred lights and picking it out is the whole problem.
//   07b  the same clearing, and then `DeleteVob` on the torch. The one op under
//        test, against a frame where its effect is the only thing that can have
//        changed. **A partial removal is the interesting failure** — a flame
//        with no post, a glow with no flame — and it is only interesting if
//        there is nothing else glowing.
//   07c  the 2,895-waypoint renumber and *nothing else*. `05` bundled it with a
//        subtree delete and four other waynet ops, so a broken routine there
//        would have implicated six edits; here it can only be the renumber.
//
// Fog is deliberately left alone: NewWorld's ambient range is 16,000 units and
// the torch is 318 away, so no fog zone can hide this row, and clearing them
// would be a second difference from `00` for nothing.
// ---------------------------------------------------------------------------

/**
 * Clear the noise out of the spawn's frame, keeping anything under `keep`.
 *
 * `06`'s clearing with one exception, and the exception is the point: the VOB
 * under test in `07a`/`07b` is a torch whose five children are two lights, two
 * particle effects and a lens flare — every one of them a class this would
 * otherwise delete, which would leave nothing for `DeleteVob` to be seen
 * removing.
 *
 * Returns the paths rather than deleting them, because `07b` has one more to
 * add and the order the two are deleted in is what keeps every path valid.
 */
const frameNoiseKeeping = (before, start, keep) => {
  const [sx, sy, sz] = start.position;
  const near = (v) => Math.hypot(v.position[0] - sx, v.position[1] - sy, v.position[2] - sz) <= QUIET_RADIUS;
  const kept = (v) => v.path === keep || v.path.startsWith(`${keep}/`);
  const doomed = before.vobs
    .filter((v) => NOISE_CLASSES.has(v.class) && near(v) && !kept(v))
    .map((v) => v.path);
  if (doomed.length < 10) throw new Error(`only ${doomed.length} VOBs to clear — re-measure, the frame is not being cleared`);
  return doomed;
};

/** Light/sound/effect VOBs still standing inside the frame. */
const noiseLeft = (dump, start) => {
  const [sx, sy, sz] = start.position;
  return dump.vobs.filter((v) => NOISE_CLASSES.has(v.class)
    && Math.hypot(v.position[0] - sx, v.position[1] - sy, v.position[2] - sz) <= QUIET_RADIUS);
};

const torchKept = stage('07a-frame-torch');
const torchGone = stage('07b-frame-torch-deleted');
{
  // Measured once off the pristine world and used by both files, so the pair is
  // an A/B of one difference and not of two builds that drifted.
  const probe = zk.normalizeWorld(zk.loadWorld(src, 'g2'));
  const startWp = probe.waynet.waypoints.find((w) => w.name === 'START');
  if (!startWp) throw new Error('no START waypoint');
  const torch = at(probe, TORCH_SUBTREE);
  const children = probe.vobs.filter((v) => v.path.startsWith(`${TORCH_SUBTREE}/`));
  if (children.length !== 5) throw new Error(`${TORCH_SUBTREE} has ${children.length} children, expected 5`);
  // Two `zCVobLight` and three plain `zCVob`s carrying `ZFLARE6.TGA`,
  // `FIRE_MEDIUM.pfx` and `FIRE_SPARKS.pfx`. Measured, not assumed — the first
  // build of this candidate expected five VOBs of the classes the frame-clearer
  // knows about and found two, because **a torch's flame is not a
  // `zCPFXController`**. It is why `06` leaves the frame's other fires burning,
  // and why the test torch's two lights are what make it the only *lit* thing
  // in the clearing rather than the only visible one.
  const sig = (v) => `${v.class}|${v.visual}`;
  const subtreeSigs = new Set([torch, ...children].map(sig));
  /**
   * Everything at the torch's spot that looks like a piece of the torch.
   *
   * **Full 3D distance, and that is the point.** `2/76` is the same wall torch
   * model 102 units away in XZ and 884 units *below* — a second storey of the
   * same wall. An XZ-only test found ten pieces where six were expected, and
   * the same confusion is available to the eye: the run sheet has to say which
   * of the two torches this row is about, or a lower torch still burning reads
   * as a delete that did not happen.
   */
  const atTorch = (dump) => dump.vobs.filter((v) => subtreeSigs.has(sig(v)) && Math.hypot(
    v.position[0] - torch.position[0],
    v.position[1] - torch.position[1],
    v.position[2] - torch.position[2],
  ) < 200);
  const away = Math.hypot(
    torch.position[0] - startWp.position[0],
    torch.position[1] - startWp.position[1],
    torch.position[2] - startWp.position[2],
  );
  if (away > QUIET_RADIUS) throw new Error(`the torch is ${away.toFixed(0)} from START — outside the frame this clears`);

  for (const [file, deleteTorch] of [[torchKept, false], [torchGone, true]]) {
    const label = path.basename(file, '.zen');
    const handle = zk.loadWorld(src, 'g2');
    const before = zk.normalizeWorld(handle);
    const doomed = frameNoiseKeeping(before, startWp, TORCH_SUBTREE);
    // The torch's own root joins the list rather than being deleted before or
    // after it: sorted descending, every path is still valid when its turn
    // comes, and the root goes with its five children still under it — which is
    // the subtree delete this row exists to witness, not five deletes and a
    // sixth.
    const order = (deleteTorch ? [...doomed, TORCH_SUBTREE] : doomed).sort(byPathDesc);
    for (const p of order) zk.deleteVob(handle, p);
    zk.saveWorld(handle, file);

    const after = zk.normalizeWorld(zk.loadWorld(file, 'g2'));

    // The subtree itself, not a proxy for it: all six pieces still standing at
    // the torch's spot, or none. Partial removal is the failure this row is for,
    // and it has to be caught here as well as by eye.
    const standing = atTorch(after);
    const owedStanding = deleteTorch ? 0 : 1 + children.length;
    if (standing.length !== owedStanding) {
      throw new Error(`${label}: ${standing.length} pieces of the torch left, expected ${owedStanding}`
        + ` (${standing.map(sig).join(', ')})`);
    }
    // And the frame around it is dead either way: every light in `07a` belongs
    // to the torch, and `07b` leaves none at all.
    const left = noiseLeft(after, startWp);
    const owedLeft = deleteTorch ? 0 : children.filter((v) => NOISE_CLASSES.has(v.class)).length;
    if (left.length !== owedLeft) {
      throw new Error(`${label}: ${left.length} light/sound/effect VOBs inside the frame, expected ${owedLeft}`);
    }
    // What a delete costs is its whole subtree, not one row — and in this frame
    // that is not the same number. One of the cleared VOBs carries a child of
    // its own, so 230 paths take 231 VOBs with them; `06` never noticed because
    // it only counted what was left, not what went.
    const went = before.vobs.length - after.vobs.length;
    const owed = before.vobs.filter((v) => order.some((p) => v.path === p || v.path.startsWith(`${p}/`))).length;
    if (went !== owed) throw new Error(`${label}: ${went} VOBs went, expected ${owed}`);

    console.log(`\n${label}  cleared ${doomed.length} within ${QUIET_RADIUS} of START, torch ${deleteTorch ? 'DELETED with its 5 children' : 'kept'}`);
    console.log(`    torch ${TORCH_SUBTREE} "${torch.visual}" ${away.toFixed(0)} units from START`);
    console.log(`    vobs ${before.vobs.length} -> ${after.vobs.length} (${order.length} paths, ${owed} VOBs with their children)`);
    console.log(`    torch pieces standing ${standing.length}, lights/sounds/effects left in frame ${left.length}`);
  }
}

const renumber = stage('07c-renumber-only');
{
  const handle = zk.loadWorld(src, 'g2');
  const before = zk.normalizeWorld(handle);
  const wpBefore = before.waynet.waypoints.length;
  // The waypoints the two routines the run sheet watches actually name. They
  // sit *before* the deleted one in stored order, so they do not move — what
  // moves is every one of the waypoints after it, which is what a route has to
  // survive being renumbered around.
  const WATCHED = ['NW_XARDAS_TOWER_IN1_28', 'NW_XARDAS_TOWER_IN1_31'];
  for (const name of WATCHED) {
    if (!before.waynet.waypoints.some((w) => w.name === name)) {
      throw new Error(`${name} is not in this world — the run sheet watches a routine that cannot run`);
    }
  }

  zk.removeWaypoint(handle, DELETE_WP.index, DELETE_WP.name, true);
  zk.saveWorld(handle, renumber);

  const rh = zk.loadWorld(renumber, 'g2');
  const after = zk.normalizeWorld(rh);
  // `danglingEdges` is `getWaynet`'s — `normalizeWorld` reports waypoints and
  // edges and does not count them, and reading it off the wrong one is
  // `undefined`, which is not 0 and would have passed a `!== 0` test by luck.
  const dangling = zk.getWaynet(rh).danglingEdges;
  const names = after.waynet.waypoints.map((w) => w.name);
  if (after.waynet.waypoints.length !== wpBefore - 1) {
    throw new Error(`waypoints ${wpBefore} -> ${after.waynet.waypoints.length}, expected exactly one gone`);
  }
  if (names.includes(DELETE_WP.name)) throw new Error(`${DELETE_WP.name} survived the delete`);
  for (const name of WATCHED) {
    if (!names.includes(name)) throw new Error(`${name} went with the renumber — the routine has lost its waypoint`);
  }
  if (dangling !== 0) throw new Error(`${dangling} dangling edges after the renumber`);
  // Nothing else changed, which is the whole claim of this candidate.
  if (after.vobs.length !== before.vobs.length) {
    throw new Error(`${before.vobs.length - after.vobs.length} VOBs changed in a waynet-only candidate`);
  }

  console.log(`\n07c  removed waypoint ${DELETE_WP.index} ${DELETE_WP.name}, renumbering ${wpBefore - DELETE_WP.index - 1}`);
  console.log(`    waypoints ${wpBefore} -> ${after.waynet.waypoints.length}, dangling ${dangling}, vobs unchanged at ${after.vobs.length}`);
  console.log(`    watched routine waypoints still present: ${WATCHED.join(', ')}`);
}

for (const [name, file] of [
  ['00-control-original', control], ['01-resave', resave], ['02-minimal-edit', edited],
  ['03-class-props', classProps], ['04-authored-classes', authored], ['05-deletes-waynet', deletes],
  ['06-minimal-frame', minimal], ['07a-frame-torch', torchKept],
  ['07b-frame-torch-deleted', torchGone], ['07c-renumber-only', renumber],
]) {
  console.log(`\n${name}  ${fs.statSync(file).size} B  ${sha(file)}`);
}
console.log(`\nrun: pwsh tools/engine-batch.ps1 -Dir "${path.resolve(outDir)}" -Only 00,07`);
