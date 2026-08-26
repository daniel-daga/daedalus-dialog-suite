'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');

// `getWaynet` is to `normalizeWorld().waynet` what `vobIndex` is to the VOB
// dump: the render path's version of the same data. The dump sorts waypoints by
// name and sorts each edge pair, because order is noise to a diff. An overlay
// needs the opposite — stored order, and edges as index pairs into it, because
// a line buffer is built from indices and a name lookup per edge is thousands
// of string comparisons for a picture.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-waynet-'));
const FIXTURE = path.join(dir, 'waynet.g2.zen');
zenkit._authorFixtureWorld(FIXTURE, 'binsafe', 'g2', 'mesh-extraction');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const waynet = () => zenkit.getWaynet(zenkit.loadWorld(FIXTURE, 'g2'));
const f32 = (buf) => Array.from(new Float32Array(buf));
const u32 = (buf) => Array.from(new Uint32Array(buf));

test('getWaynet emits every waypoint, columnar', () => {
  const net = waynet();

  assert.strictEqual(net.count, 5);
  assert.deepStrictEqual([...net.names].sort(),
    ['FP_FIXTURE_FREE', 'WP_FIXTURE_A', 'WP_FIXTURE_B', 'WP_FIXTURE_C', 'WP_FIXTURE_DEEP']);
  assert.strictEqual(f32(net.positions).length, 5 * 3);
  assert.strictEqual(f32(net.directions).length, 5 * 3);
  assert.strictEqual(u32(net.flags).length, 5);
  assert.strictEqual(new Int32Array(net.waterDepths).length, 5);
});

test('getWaynet keeps positions in ZenGin space, unconverted', () => {
  // Same rule as every other payload: the single conversion is zen-world/coords
  // at the render boundary, and nothing below it flips an axis or scales.
  const net = waynet();
  const at = [...net.names].indexOf('FP_FIXTURE_FREE');
  const positions = f32(net.positions);
  const directions = f32(net.directions);

  assert.deepStrictEqual(positions.slice(at * 3, at * 3 + 3), [50, 0, 50]);
  assert.deepStrictEqual(directions.slice(at * 3, at * 3 + 3), [0, 0, 1]);
});

test('getWaynet packs freePoint and underWater as flag bits', () => {
  const net = waynet();
  const flags = u32(net.flags);
  const names = [...net.names];

  // bit 0 freePoint, bit 1 underWater.
  assert.strictEqual(flags[names.indexOf('FP_FIXTURE_FREE')] & 1, 1);
  assert.strictEqual(flags[names.indexOf('WP_FIXTURE_A')] & 1, 0);

  // The two bits are independent, and only a waypoint that is underwater
  // without being a free point can show that they are.
  const deep = names.indexOf('WP_FIXTURE_DEEP');
  assert.strictEqual(flags[deep] & 2, 2);
  assert.strictEqual(flags[deep] & 1, 0);
  assert.strictEqual(flags[names.indexOf('FP_FIXTURE_FREE')] & 2, 0);
  assert.strictEqual(new Int32Array(net.waterDepths)[deep], 250);
});

test('getWaynet emits edges as index pairs into its own point list', () => {
  // The whole reason this is not the dump: an overlay indexes a position
  // buffer, and every index has to be in range or it draws a line to nowhere.
  const net = waynet();
  const edges = u32(net.edges);
  const names = [...net.names];

  assert.strictEqual(net.edgeCount, 4);
  assert.strictEqual(edges.length, 8);
  for (const index of edges) {
    assert.ok(index < net.count, `edge endpoint ${index} is outside 0..${net.count - 1}`);
  }

  const pairs = [];
  for (let i = 0; i < edges.length; i += 2) {
    pairs.push([names[edges[i]], names[edges[i + 1]]].sort().join('-'));
  }
  assert.deepStrictEqual(pairs.sort(),
    ['WP_FIXTURE_A-WP_FIXTURE_B', 'WP_FIXTURE_A-WP_FIXTURE_C', 'WP_FIXTURE_B-WP_FIXTURE_C',
      'WP_FIXTURE_C-WP_FIXTURE_DEEP']);
});

test('getWaynet reports edges it had to drop rather than hiding them', () => {
  // An endpoint that is not in the point list cannot be drawn and cannot be
  // named. The fixture has none, so this pins that "no edges drawn" and
  // "no edges to draw" stay distinguishable.
  assert.strictEqual(waynet().danglingEdges, 0);
});

test('getWaynet agrees with the dump on which waypoints exist', () => {
  // Two independent readers over the same waynet: if they disagree, one of them
  // is filtering something the other is not.
  const net = waynet();
  const dumped = zenkit.normalizeWorld(zenkit.loadWorld(FIXTURE, 'g2')).waynet;

  assert.deepStrictEqual([...net.names].sort(), dumped.waypoints.map((wp) => wp.name).sort());
  assert.strictEqual(net.edgeCount, dumped.edges.length);
});
