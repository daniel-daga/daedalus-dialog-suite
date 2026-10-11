'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const zenkit = require('../lib');
const {
  summarizeStartPositions,
  START_WAYPOINT_NAMES,
} = require('../scripts/check-world-properties.js');

// What the `oCWorld:zCWorld` wrapper actually carries — level-editor.md §14.3
// 3.5 lists "start position, sky and time control" as unexposed, and this is
// the readout that says which of the three is in a world file at all.
//
// `worldProperties` is the world-level half: the archive wrapper plus the
// fields ZenKit's `World` models beyond vobs/mesh/bsp/waynet. Those are the
// save-game ones, so a world `.zen` is expected to leave every one of them
// empty — which is the finding, not an accident of the fixture.

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');

test('worldProperties reports the oCWorld wrapper the handle re-saves through', () => {
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  const props = zenkit.worldProperties(handle);

  assert.strictEqual(props.gameVersion, 'g2');
  assert.strictEqual(props.format, 'binsafe');
  assert.strictEqual(props.rootObjectName, '%');
  assert.strictEqual(props.rootClassName, 'oCWorld:zCWorld');
  assert.strictEqual(typeof props.rootVersion, 'number');
});

test('a world .zen carries no sky, no time and no NPC spawn state', () => {
  // The save-game-only members of `zenkit::World`. All empty here, and the
  // corpus readout (`scripts/check-world-properties.js`) reports the same for
  // the retail worlds: sky and time control are not in a world file, so
  // "expose them" is not a matter of plumbing an existing field.
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  const props = zenkit.worldProperties(handle);

  assert.strictEqual(props.skyController, null);
  assert.strictEqual(props.player, null);
  assert.strictEqual(props.npcCount, 0);
  assert.strictEqual(props.npcSpawnCount, 0);
  assert.strictEqual(props.npcSpawnEnabled, false);
  assert.strictEqual(props.npcSpawnFlags, 0);
});

// The start position is the half that IS in a world file, and it is not an
// `oCWorld` field at all: it is a `zCVobStartpoint` in the vob tree, or a
// waypoint the engine looks up by name. These pin the summarizer the corpus
// readout counts with.

/** A `vobIndex`-shaped column set from `[class, name, position]` triples. */
function fakeIndex(vobs) {
  const classes = [];
  const names = [];
  const classIndex = new Uint32Array(vobs.length);
  const nameIndex = new Uint32Array(vobs.length);
  const positions = new Float32Array(vobs.length * 3);
  vobs.forEach(([cls, name, position], at) => {
    let c = classes.indexOf(cls);
    if (c < 0) { c = classes.push(cls) - 1; }
    let n = names.indexOf(name);
    if (n < 0) { n = names.push(name) - 1; }
    classIndex[at] = c;
    nameIndex[at] = n;
    positions.set(position, at * 3);
  });
  return {
    count: vobs.length,
    classes,
    classIndex: classIndex.buffer,
    names,
    nameIndex: nameIndex.buffer,
    positions: positions.buffer,
  };
}

/** A `getWaynet`-shaped graph from `[name, position]` pairs. */
function fakeWaynet(points) {
  const positions = new Float32Array(points.length * 3);
  points.forEach(([, position], at) => positions.set(position, at * 3));
  return {
    count: points.length,
    names: points.map(([name]) => name),
    positions: positions.buffer,
  };
}

test('a start position is a zCVobStartpoint, whatever the VOB is named', () => {
  const summary = summarizeStartPositions(
    fakeIndex([
      ['zCVob', 'FIXTURE_ROOT', [0, 0, 0]],
      ['zCVobStartpoint', 'START_OLDCAMP', [1, 2, 3]],
      ['zCVobSpot', 'START', [9, 9, 9]],
    ]),
    fakeWaynet([])
  );

  assert.deepStrictEqual(summary.startpointVobs, [
    { name: 'START_OLDCAMP', position: [1, 2, 3] },
  ]);
  // A spot merely *named* START is not a startpoint: the class is the marker.
  assert.deepStrictEqual(summary.startWaypoints, []);
});

test('a start waypoint is matched by name, case-insensitively', () => {
  const summary = summarizeStartPositions(
    fakeIndex([]),
    fakeWaynet([
      ['WP_INTRO_01', [0, 0, 0]],
      ['start', [10, 20, 30]],
      ['STARTPOINT', [40, 50, 60]],
    ])
  );

  assert.deepStrictEqual(summary.startWaypoints, [
    { name: 'start', position: [10, 20, 30] },
    { name: 'STARTPOINT', position: [40, 50, 60] },
  ]);
  assert.deepStrictEqual(START_WAYPOINT_NAMES, ['START', 'STARTPOINT']);
});

test('the golden fixture has neither, so both halves report empty', () => {
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  const summary = summarizeStartPositions(zenkit.vobIndex(handle), zenkit.getWaynet(handle));

  assert.deepStrictEqual(summary.startpointVobs, []);
  assert.deepStrictEqual(summary.startWaypoints, []);
});
