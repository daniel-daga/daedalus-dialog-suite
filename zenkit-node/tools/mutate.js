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

const WORLDS = process.env.ZENKIT_G2_WORLDS
  || 'C:/Program Files (x86)/Steam/steamapps/common/Gothic II/_work/Data/Worlds';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: node tools/mutate.js <outDir> [<NewWorld.zen>]');
const source = process.argv[3] || `${WORLDS}/NewWorld/NewWorld.zen`;

// Prefer the pristine backup when one exists — the install may be mid-experiment.
const backup = `${source}.original-backup`;
const src = fs.existsSync(backup) ? backup : source;

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

for (const [name, file] of [
  ['00-control-original', control], ['01-resave', resave], ['02-minimal-edit', edited],
  ['03-class-props', classProps], ['04-authored-classes', authored], ['05-deletes-waynet', deletes],
]) {
  console.log(`\n${name}  ${fs.statSync(file).size} B  ${sha(file)}`);
}
console.log(`\nrun: pwsh tools/engine-batch.ps1 -Exe Gothic2 -Dir "${path.resolve(outDir)}"`);
