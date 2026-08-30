'use strict';

// What does a world file actually carry at the `oCWorld`/`zCWorld` level?
// (level-editor.md §14.3 3.5, which lists "start position, sky and time
// control" as unexposed.)
//
// Making those editable is a scoping call; knowing whether they are in a world
// file at all is not, and until now nobody had looked. This is the readout:
// for each world it prints `worldProperties` — the archive wrapper plus every
// member `zenkit::World` models beyond vobs/mesh/BSP/waynet — and the start
// positions, which are not an `oCWorld` field at all but a `zCVobStartpoint`
// in the vob tree and a waypoint the engine looks up by name.
//
//   node scripts/check-world-properties.js [--world <a.zen> ...]
//
// With no `--world` it reads the retail worlds out of `worlds/`, which is
// gitignored and rebuilt by `scripts/extract-worlds.js` from an installation,
// so this is developer-local; nothing in CI runs it. The pure summarizer below
// is covered by `test/worldProperties.test.js`, which also pins the binding
// readout against the golden fixture.

const fs = require('node:fs');
const path = require('node:path');

/** The retail worlds the measurements in the docs are taken over. */
const RETAIL_WORLDS = ['NEWWORLD.ZEN', 'OLDWORLD.ZEN', 'ADDONWORLD.ZEN'];

/** The waypoint names ZenGin resolves a player start against. */
const START_WAYPOINT_NAMES = ['START', 'STARTPOINT'];

function positionAt(buffer, at) {
  const positions = new Float32Array(buffer, at * 12, 3);
  return [positions[0], positions[1], positions[2]];
}

/**
 * The start positions of one world: the `zCVobStartpoint` VOBs of a `vobIndex`
 * and the start-named waypoints of a `getWaynet` graph. The VOB half is keyed
 * on the class, never the name — a VOB called `START` of any other class is a
 * marker for something else.
 */
function summarizeStartPositions(index, waynet) {
  const startpointClass = index.classes.indexOf('zCVobStartpoint');
  const classIndex = new Uint32Array(index.classIndex);
  const nameIndex = new Uint32Array(index.nameIndex);

  const startpointVobs = [];
  if (startpointClass >= 0) {
    for (let at = 0; at < index.count; at += 1) {
      if (classIndex[at] !== startpointClass) continue;
      startpointVobs.push({
        name: index.names[nameIndex[at]],
        position: positionAt(index.positions, at),
      });
    }
  }

  const startWaypoints = [];
  for (let at = 0; at < waynet.count; at += 1) {
    const name = waynet.names[at];
    if (!START_WAYPOINT_NAMES.includes(name.toUpperCase())) continue;
    startWaypoints.push({ name, position: positionAt(waynet.positions, at) });
  }

  return { startpointVobs, startWaypoints };
}

function parseArgs(argv) {
  const worlds = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--world') worlds.push(argv[i + 1]);
  }
  if (worlds.length > 0) return worlds;

  const dir = path.join(__dirname, '..', 'worlds');
  const missing = RETAIL_WORLDS.filter((name) => !fs.existsSync(path.join(dir, name)));
  if (missing.length > 0) {
    throw new Error(`missing from worlds/: ${missing.join(', ')} — run scripts/extract-worlds.js`);
  }
  return RETAIL_WORLDS.map((name) => path.join(dir, name));
}

function formatPosition([x, y, z]) {
  return `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
}

function main() {
  const zenkit = require('..');
  const worlds = parseArgs(process.argv.slice(2));

  for (const world of worlds) {
    const handle = zenkit.loadWorld(world, 'g2');
    const props = zenkit.worldProperties(handle);
    const starts = summarizeStartPositions(zenkit.vobIndex(handle), zenkit.getWaynet(handle));

    console.log(`\n${path.basename(world)}`);
    console.log(`  wrapper       ${props.rootObjectName} ${props.rootClassName}`
      + ` v${props.rootVersion}  [${props.format}, ${props.gameVersion}]`);
    console.log(`  sky / time    ${props.skyController === null ? 'absent'
      : JSON.stringify(props.skyController)}`);
    console.log(`  cutscene      ${props.player === null ? 'absent'
      : JSON.stringify(props.player)}`);
    console.log(`  npc spawn     enabled=${props.npcSpawnEnabled} flags=${props.npcSpawnFlags}`
      + ` npcs=${props.npcCount} spawns=${props.npcSpawnCount}`);
    console.log(`  startpoints   ${starts.startpointVobs
      .map((v) => `${v.name || '(unnamed)'} ${formatPosition(v.position)}`).join(', ') || 'none'}`);
    console.log(`  start waypts  ${starts.startWaypoints
      .map((w) => `${w.name} ${formatPosition(w.position)}`).join(', ') || 'none'}`);
  }
  console.log('');
}

module.exports = { summarizeStartPositions, START_WAYPOINT_NAMES, RETAIL_WORLDS };

if (require.main === module) main();
