'use strict';

// setWaypointPosition — the first mutation in this binding that is not about a
// VOB (level-editor.md §7, the waynet slice).
//
// A waypoint has one address and it is a bare index into the point list
// `getWaynet` emits. That is safe for a *move* and for nothing else: the list is
// filled once at load and never reordered, and a move cannot insert, delete or
// reorder — so the enumeration an op was made against is the one it is applied
// against. The two things these tests exist to pin are that the mutation's
// notion of that index is `getWaynet`'s, and that a wrong one is refused rather
// than moving whichever waypoint it now names.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const zenkit = require('..');

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');

function load() {
  return zenkit.loadWorld(FIXTURE, 'g2');
}

/** The index `getWaynet` gives `name` — the address an op would carry. */
function indexOf(handle, name) {
  const at = zenkit.getWaynet(handle).names.indexOf(name);
  assert.notStrictEqual(at, -1, `no waypoint named ${name} in the fixture`);
  return at;
}

function waypointsOf(handle) {
  return zenkit.normalizeWorld(handle).waynet.waypoints;
}

test('setWaypointPosition moves the waypoint at getWaynet\'s own index', () => {
  // The test that binds the two enumerations.
  //
  // **Measured limit, stated rather than implied:** on this fixture it cannot
  // fail for the reason it exists. `getWaynet`'s list drops the null slots of
  // `way_net->points` and the fixture has none, so the filtered and raw lists
  // are identical and a mutation that skipped the filter passes this test.
  // Sabotaged and confirmed: the other three sabotages of this file are caught,
  // that one survives. What actually prevents the drift is structural — both
  // callers go through `CollectWaypoints`, which is the single definition of
  // what a waypoint index means — and a fixture with a null slot cannot be
  // authored through `_authorFixtureWorld` today. Do not read this test as
  // coverage of the filter; read it as coverage of the index being the same
  // number on both sides.
  const handle = load();
  const at = indexOf(handle, 'WP_FIXTURE_B');

  zenkit.setWaypointPosition(handle, at, 'WP_FIXTURE_B', [11.5, 22.5, 33.5]);

  const moved = waypointsOf(handle).find((point) => point.name === 'WP_FIXTURE_B');
  assert.deepStrictEqual(moved.position, [11.5, 22.5, 33.5]);
});

test('setWaypointPosition touches nothing but that waypoint\'s position', () => {
  const handle = load();
  const before = waypointsOf(load());
  const at = indexOf(handle, 'WP_FIXTURE_B');

  zenkit.setWaypointPosition(handle, at, 'WP_FIXTURE_B', [11.5, 22.5, 33.5]);

  const after = waypointsOf(handle);
  assert.strictEqual(after.length, before.length);
  after.forEach((point, i) => {
    const was = before[i];
    if (point.name === 'WP_FIXTURE_B') {
      // Everything but the position, field by field — `direction` especially:
      // it is the field a move is most likely to be confused with, and a
      // waypoint facing the wrong way is invisible in every count.
      assert.deepStrictEqual({ ...point, position: was.position }, was);
    } else {
      assert.deepStrictEqual(point, was);
    }
  });
});

test('setWaypointPosition leaves the edge list alone', () => {
  // A moved waypoint is the same object every edge already points at, so the
  // edges cannot need rewriting — and if they were rewritten, they would be
  // wrong. Asserted rather than assumed, because `WayNet::save` writes edge
  // endpoints and this is the op that first makes that matter.
  const handle = load();
  const before = zenkit.normalizeWorld(load()).waynet.edges;

  zenkit.setWaypointPosition(handle, indexOf(handle, 'WP_FIXTURE_A'), 'WP_FIXTURE_A', [1, 2, 3]);

  assert.deepStrictEqual(zenkit.normalizeWorld(handle).waynet.edges, before);
});

test('setWaypointPosition refuses an index outside the point list', () => {
  const handle = load();
  const count = zenkit.getWaynet(handle).names.length;

  assert.throws(() => zenkit.setWaypointPosition(handle, count, 'WP_FIXTURE_A', [1, 2, 3]), /no waypoint/);
  assert.throws(() => zenkit.setWaypointPosition(handle, -1, 'WP_FIXTURE_A', [1, 2, 3]), /no waypoint/);
});

test('setWaypointPosition refuses a name that is not the one at that index', () => {
  // The whole point of carrying the name. Without this the call moves a
  // waypoint — just not the one the op meant — and reports success.
  const handle = load();
  const at = indexOf(handle, 'WP_FIXTURE_B');

  assert.throws(
    () => zenkit.setWaypointPosition(handle, at, 'WP_FIXTURE_C', [1, 2, 3]),
    /WP_FIXTURE_B.*WP_FIXTURE_C|changed under this op/s
  );
  // And it refused *before* writing.
  const untouched = waypointsOf(handle).find((point) => point.name === 'WP_FIXTURE_B');
  assert.notDeepStrictEqual(untouched.position, [1, 2, 3]);
});

test('setWaypointPosition survives a save and a reload, edges intact', () => {
  // `WayNet::save` writes free points and then every edge endpoint, and
  // `WriteArchive::write_object` de-duplicates by pointer — so a waypoint
  // shared by N edges is written once, with the new position, and referenced N
  // times. This is the assertion that says a move cannot desynchronise a
  // waypoint from itself.
  const handle = load();
  const at = indexOf(handle, 'WP_FIXTURE_A');
  zenkit.setWaypointPosition(handle, at, 'WP_FIXTURE_A', [7.5, 8.5, 9.5]);

  const saved = path.join(
    require('node:os').tmpdir(), `zenkit-waynet-${process.pid}.zen`
  );
  try {
    zenkit.saveWorld(handle, saved);
    const reloaded = zenkit.loadWorld(saved, 'g2');
    const dump = zenkit.normalizeWorld(reloaded);

    assert.strictEqual(dump.waynet.waypoints.length, waypointsOf(load()).length);
    assert.deepStrictEqual(
      dump.waynet.waypoints.find((point) => point.name === 'WP_FIXTURE_A').position,
      [7.5, 8.5, 9.5]
    );
    assert.deepStrictEqual(dump.waynet.edges, zenkit.normalizeWorld(load()).waynet.edges);
  } finally {
    require('node:fs').rmSync(saved, { force: true });
  }
});

// setWaypointName — the rename (level-editor.md §16.7, W1).
//
// It renumbers nothing, so it stands on the same index+name pair a move does:
// the index is `getWaynet`'s and the name is checked, never resolved. The
// edges need no rewriting for the same reason a move does not — `WayNet::save`
// writes edge endpoints by pointer identity, so an edge into a renamed
// waypoint is an edge into the same object.

test('setWaypointName renames the waypoint at getWaynet\'s own index', () => {
  const handle = load();
  const at = indexOf(handle, 'WP_FIXTURE_B');

  zenkit.setWaypointName(handle, at, 'WP_FIXTURE_B', 'WP_RENAMED');

  assert.strictEqual(zenkit.getWaynet(handle).names[at], 'WP_RENAMED');
  assert.strictEqual(
    waypointsOf(handle).filter((point) => point.name === 'WP_FIXTURE_B').length, 0
  );
});

test('setWaypointName touches nothing but that waypoint\'s name', () => {
  const handle = load();
  const before = waypointsOf(load());
  const at = indexOf(handle, 'WP_FIXTURE_B');

  zenkit.setWaypointName(handle, at, 'WP_FIXTURE_B', 'WP_RENAMED');

  // Compared by name rather than by position in the list: `normalizeWorld`
  // emits the waypoints sorted by name, so a rename moves the renamed one
  // within the dump, and a positional comparison reads that reordering as a
  // moved waypoint.
  const after = waypointsOf(handle);
  assert.strictEqual(after.length, before.length);
  for (const point of before) {
    const still = after.find(
      (candidate) => candidate.name === (point.name === 'WP_FIXTURE_B' ? 'WP_RENAMED' : point.name)
    );
    assert.deepStrictEqual({ ...still, name: point.name }, point);
  }
});

test('setWaypointName refuses an index outside the point list, and a name that is not the one there', () => {
  const handle = load();
  const count = zenkit.getWaynet(handle).names.length;

  assert.throws(() => zenkit.setWaypointName(handle, count, 'WP_FIXTURE_A', 'WP_X'), /no waypoint/);
  assert.throws(() => zenkit.setWaypointName(handle, -1, 'WP_FIXTURE_A', 'WP_X'), /no waypoint/);
  assert.throws(
    () => zenkit.setWaypointName(handle, indexOf(handle, 'WP_FIXTURE_B'), 'WP_FIXTURE_C', 'WP_X'),
    /WP_FIXTURE_B.*WP_FIXTURE_C|changed under this op/s
  );
  assert.notStrictEqual(zenkit.getWaynet(handle).names.indexOf('WP_FIXTURE_B'), -1);
});

test('setWaypointName refuses an empty name and one another waypoint already has', () => {
  // A waypoint with no name cannot be addressed by the index+name pair at all,
  // and a duplicate is what makes every by-name lookup — the script index the
  // panel shows, above all — ambiguous. Nothing in the format forbids either;
  // retail has neither, in 24 worlds and 12,341 waypoints.
  const handle = load();
  const at = indexOf(handle, 'WP_FIXTURE_B');

  assert.throws(() => zenkit.setWaypointName(handle, at, 'WP_FIXTURE_B', ''), /empty/);
  assert.throws(
    () => zenkit.setWaypointName(handle, at, 'WP_FIXTURE_B', 'WP_FIXTURE_A'), /already/
  );
  assert.strictEqual(zenkit.getWaynet(handle).names[at], 'WP_FIXTURE_B');
});

test('setWaypointName survives a save and a reload, edges intact', () => {
  // The assertion that says a rename cannot desynchronise a waypoint from
  // itself: `WriteArchive::write_object` de-duplicates by pointer, so a
  // waypoint shared by N edges is written once with the new name and
  // referenced N times. An edge list that still named the old one would be an
  // edge into a waypoint the file does not have.
  const handle = load();
  const at = indexOf(handle, 'WP_FIXTURE_A');
  zenkit.setWaypointName(handle, at, 'WP_FIXTURE_A', 'WP_RENAMED_A');

  const saved = path.join(
    require('node:os').tmpdir(), `zenkit-waynet-rename-${process.pid}.zen`
  );
  try {
    zenkit.saveWorld(handle, saved);
    const dump = zenkit.normalizeWorld(zenkit.loadWorld(saved, 'g2'));
    const was = zenkit.normalizeWorld(load());

    assert.strictEqual(dump.waynet.waypoints.length, was.waynet.waypoints.length);
    assert.notStrictEqual(
      dump.waynet.waypoints.findIndex((point) => point.name === 'WP_RENAMED_A'), -1
    );
    assert.strictEqual(dump.waynet.edges.length, was.waynet.edges.length);
  } finally {
    require('node:fs').rmSync(saved, { force: true });
  }
});
