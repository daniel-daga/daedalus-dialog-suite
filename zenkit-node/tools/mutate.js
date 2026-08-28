'use strict';
// Builds the three candidate worlds for the T10 / E-full engine pass
// (docs/engine-acceptance-2026-08-25.md §8), into a directory
// `tools/engine-batch.ps1 -Dir <abs path>` can run:
//
//   00-control-original.zen   the pristine retail world (the control)
//   01-resave.zen             load → save, unchanged (checklist rows 2–9)
//   02-minimal-edit.zen       the two Phase-0 mutations (row 10)
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

for (const [name, file] of [['00-control-original', control], ['01-resave', resave], ['02-minimal-edit', edited]]) {
  console.log(`\n${name}  ${fs.statSync(file).size} B  ${sha(file)}`);
}
console.log(`\nrun: pwsh tools/engine-batch.ps1 -Exe Gothic2 -Dir "${path.resolve(outDir)}"`);
