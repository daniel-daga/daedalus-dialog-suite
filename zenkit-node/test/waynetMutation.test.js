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

// addWaypoint / removeWaypoint — the append and its exact inverse
// (level-editor.md §16.7, W2).
//
// Appending leaves every existing index valid, which is what lets this op stand
// on the same index+name pair a move and a rename do without a new addressing
// scheme. The one thing these tests exist to pin beyond that is the free-point
// flag: `WayNet::save` writes free points plus edge endpoints, so a new
// waypoint that is not free and is in no edge is dropped at save and the add
// would silently do nothing.

test('addWaypoint appends a free waypoint and answers with its index', () => {
  const handle = load();
  const before = zenkit.getWaynet(handle);

  const at = zenkit.addWaypoint(handle, 'FP_ADDED', [12.5, 34.5, 56.5]);

  assert.strictEqual(at, before.count);
  const after = zenkit.getWaynet(handle);
  assert.strictEqual(after.count, before.count + 1);
  assert.strictEqual(after.names[at], 'FP_ADDED');
  assert.deepStrictEqual(
    Array.from(new Float32Array(after.positions)).slice(at * 3, at * 3 + 3),
    [12.5, 34.5, 56.5]
  );
  // Bit 0 of the flags column is `free_point` — the bit that decides whether
  // `WayNet::save` writes this waypoint at all.
  assert.strictEqual(new Uint32Array(after.flags)[at] & 1, 1);
});

test('addWaypoint leaves every existing waypoint and every edge alone', () => {
  const handle = load();
  const before = zenkit.normalizeWorld(load());

  zenkit.addWaypoint(handle, 'FP_ADDED', [12.5, 34.5, 56.5]);

  const after = zenkit.normalizeWorld(handle);
  assert.deepStrictEqual(after.waynet.edges, before.waynet.edges);
  for (const point of before.waynet.waypoints) {
    assert.deepStrictEqual(
      after.waynet.waypoints.find((candidate) => candidate.name === point.name), point
    );
  }
});

test('addWaypoint refuses an empty name and one another waypoint already has', () => {
  // The same two refusals `setWaypointName` makes, for the same reason and in
  // the same layer: the point list is the only thing that can see a collision,
  // and an unnamed waypoint cannot be addressed by the index+name pair at all.
  const handle = load();
  const count = zenkit.getWaynet(handle).count;

  assert.throws(() => zenkit.addWaypoint(handle, '', [1, 2, 3]), /empty/);
  assert.throws(() => zenkit.addWaypoint(handle, 'WP_FIXTURE_A', [1, 2, 3]), /already/);
  assert.strictEqual(zenkit.getWaynet(handle).count, count);
});

test('an added waypoint survives a save and a reload', () => {
  // The assertion the free-point flag exists for. Without it the appended point
  // is in no edge and is not written, so this reload would find the waynet it
  // started with and the add would have been a no-op nobody was told about.
  const handle = load();
  zenkit.addWaypoint(handle, 'FP_ADDED', [12.5, 34.5, 56.5]);

  const saved = path.join(
    require('node:os').tmpdir(), `zenkit-waynet-add-${process.pid}.zen`
  );
  try {
    zenkit.saveWorld(handle, saved);
    const dump = zenkit.normalizeWorld(zenkit.loadWorld(saved, 'g2'));
    const was = zenkit.normalizeWorld(load());

    assert.strictEqual(dump.waynet.waypoints.length, was.waynet.waypoints.length + 1);
    assert.deepStrictEqual(
      dump.waynet.waypoints.find((point) => point.name === 'FP_ADDED').position,
      [12.5, 34.5, 56.5]
    );
    assert.strictEqual(dump.waynet.edges.length, was.waynet.edges.length);
  } finally {
    require('node:fs').rmSync(saved, { force: true });
  }
});

test('removeWaypoint undoes an add exactly', () => {
  const handle = load();
  const before = zenkit.normalizeWorld(load());

  const at = zenkit.addWaypoint(handle, 'FP_ADDED', [12.5, 34.5, 56.5]);
  zenkit.removeWaypoint(handle, at, 'FP_ADDED', false);

  const after = zenkit.normalizeWorld(handle);
  assert.deepStrictEqual(after.waynet, before.waynet);
});

test('removeWaypoint refuses a stale name, and anything but the tail', () => {
  // The tail is the whole of what this op is for: it is the inverse of an
  // append and nothing else. Removing a waypoint in the middle renumbers every
  // index after it, which is W4's job and comes with §15's barrier.
  const handle = load();
  const at = zenkit.addWaypoint(handle, 'FP_ADDED', [12.5, 34.5, 56.5]);

  assert.throws(
    () => zenkit.removeWaypoint(handle, at, 'FP_OTHER', false), /changed under this op/
  );
  assert.throws(
    () => zenkit.removeWaypoint(handle, 0, zenkit.getWaynet(handle).names[0], false), /last/
  );
  assert.throws(() => zenkit.removeWaypoint(handle, at + 1, 'FP_ADDED', false), /no waypoint/);
  assert.strictEqual(zenkit.getWaynet(handle).count, at + 1);
});

test('removeWaypoint refuses a waypoint an edge still names', () => {
  // An edge holds its endpoints by pointer, so removing a point the edge list
  // still names would leave an edge into a waypoint the point list does not
  // have — and `WayNet::save` would write it straight back in.
  const handle = load();
  const last = zenkit.getWaynet(handle).count - 1;

  assert.throws(
    () => zenkit.removeWaypoint(handle, last, zenkit.getWaynet(handle).names[last], false), /edge/
  );
});

// addWaypointEdge / removeWaypointEdge — the edge ops (level-editor.md §16.7,
// W3).
//
// An edge is a pair of waypoints and nothing else, so both endpoints carry the
// same index+name pair every other waynet op does: the index is `getWaynet`'s
// and the name is checked, never resolved. Neither direction inserts, deletes
// or reorders a *waypoint*, so no new addressing scheme is needed — which is
// what makes this pair invertible where an arbitrary waypoint delete (W4) is
// not.
//
// The one thing that is not obvious is what a removal can destroy.
// `WayNet::save` writes free points plus edge endpoints, so a waypoint that is
// not a free point and is in no edge is not written at all: removing its last
// edge would delete it, silently, at the next save. `removeWaypointEdge`
// promotes such an endpoint to a free point instead, which is the shape every
// waypoint in a ZenGin-written world already has — `WayNet::load` marks every
// point in the points section free, so all 12,341 retail waypoints are free and
// none of them can reach this path at all.

function edgesOf(handle) {
  return zenkit.normalizeWorld(handle).waynet.edges;
}

function freePointOf(handle, name) {
  return waypointsOf(handle).find((point) => point.name === name).freePoint;
}

test('addWaypointEdge connects two waypoints addressed by index and name', () => {
  const handle = load();
  const free = indexOf(handle, 'FP_FIXTURE_FREE');
  const a = indexOf(handle, 'WP_FIXTURE_A');

  zenkit.addWaypointEdge(handle, free, 'FP_FIXTURE_FREE', a, 'WP_FIXTURE_A');

  assert.deepStrictEqual(
    edgesOf(handle).filter((edge) => edge.includes('FP_FIXTURE_FREE')),
    [['FP_FIXTURE_FREE', 'WP_FIXTURE_A']]
  );
  // The point list is untouched: an edge is a pair of the waypoints that are
  // already there, so nothing is appended and no index moves.
  assert.strictEqual(zenkit.getWaynet(handle).count, 4);
});

test('addWaypointEdge refuses a stale index, a stale name, a self-loop and a duplicate', () => {
  const handle = load();
  const a = indexOf(handle, 'WP_FIXTURE_A');
  const b = indexOf(handle, 'WP_FIXTURE_B');
  const count = zenkit.getWaynet(handle).count;

  assert.throws(
    () => zenkit.addWaypointEdge(handle, count, 'WP_FIXTURE_A', b, 'WP_FIXTURE_B'), /no waypoint/
  );
  assert.throws(
    () => zenkit.addWaypointEdge(handle, a, 'WP_FIXTURE_C', b, 'WP_FIXTURE_B'),
    /changed under this op/
  );
  assert.throws(
    () => zenkit.addWaypointEdge(handle, a, 'WP_FIXTURE_A', a, 'WP_FIXTURE_A'), /itself/
  );
  assert.throws(
    () => zenkit.addWaypointEdge(handle, a, 'WP_FIXTURE_A', b, 'WP_FIXTURE_B'), /already/
  );
  // And the duplicate is refused in the other orientation too: an edge is not
  // directed, so A–B and B–A are the same edge and drawing both would double
  // every line the overlay puts on screen.
  assert.throws(
    () => zenkit.addWaypointEdge(handle, b, 'WP_FIXTURE_B', a, 'WP_FIXTURE_A'), /already/
  );
  assert.strictEqual(edgesOf(handle).length, 3);
});

test('removeWaypointEdge deletes the edge in either orientation, and nothing else', () => {
  const handle = load();
  const before = zenkit.normalizeWorld(load());
  const a = indexOf(handle, 'WP_FIXTURE_A');
  const b = indexOf(handle, 'WP_FIXTURE_B');

  // Named in the orientation the file does *not* store it in — the fixture's
  // edge is A–B — because an edge is undirected and the caller holds whichever
  // endpoint the user happened to select first.
  zenkit.removeWaypointEdge(handle, b, 'WP_FIXTURE_B', a, 'WP_FIXTURE_A');

  const after = zenkit.normalizeWorld(handle);
  assert.deepStrictEqual(
    after.waynet.edges,
    before.waynet.edges.filter(
      (edge) => !(edge.includes('WP_FIXTURE_A') && edge.includes('WP_FIXTURE_B'))
    )
  );
  assert.deepStrictEqual(after.waynet.waypoints, before.waynet.waypoints);
});

test('removeWaypointEdge refuses an edge that is not there', () => {
  const handle = load();
  const free = indexOf(handle, 'FP_FIXTURE_FREE');
  const a = indexOf(handle, 'WP_FIXTURE_A');

  assert.throws(
    () => zenkit.removeWaypointEdge(handle, free, 'FP_FIXTURE_FREE', a, 'WP_FIXTURE_A'), /no edge/
  );
  assert.strictEqual(edgesOf(handle).length, 3);
});

test('removeWaypointEdge keeps a waypoint whose last edge it takes, as a free point', () => {
  // The hazard the section names. `WP_FIXTURE_A` is not a free point — it exists
  // in the file only as an edge endpoint — so with both of its edges gone
  // `WayNet::save` would not write it, and an edge delete would silently be a
  // waypoint delete. The promotion is what keeps a removal a removal.
  const handle = load();
  const a = indexOf(handle, 'WP_FIXTURE_A');
  assert.strictEqual(freePointOf(handle, 'WP_FIXTURE_A'), false);

  zenkit.removeWaypointEdge(
    handle, a, 'WP_FIXTURE_A', indexOf(handle, 'WP_FIXTURE_B'), 'WP_FIXTURE_B'
  );
  // One edge left, so nothing is promoted yet — the promotion is about being in
  // *no* edge, not about losing one.
  assert.strictEqual(freePointOf(handle, 'WP_FIXTURE_A'), false);

  zenkit.removeWaypointEdge(
    handle, a, 'WP_FIXTURE_A', indexOf(handle, 'WP_FIXTURE_C'), 'WP_FIXTURE_C'
  );
  assert.strictEqual(freePointOf(handle, 'WP_FIXTURE_A'), true);

  const saved = path.join(
    require('node:os').tmpdir(), `zenkit-waynet-edge-${process.pid}.zen`
  );
  try {
    zenkit.saveWorld(handle, saved);
    const dump = zenkit.normalizeWorld(zenkit.loadWorld(saved, 'g2'));

    assert.strictEqual(dump.waynet.waypoints.length, 4);
    assert.notStrictEqual(
      dump.waynet.waypoints.findIndex((point) => point.name === 'WP_FIXTURE_A'), -1
    );
    assert.deepStrictEqual(dump.waynet.edges, [['WP_FIXTURE_B', 'WP_FIXTURE_C']]);
  } finally {
    require('node:fs').rmSync(saved, { force: true });
  }
});

test('an added edge and its removal restore the graph exactly', () => {
  // The pair is each other's inverse, which is what lets one op shape carry both
  // directions. Only the *graph*, though: an endpoint promoted to a free point
  // on the way stays one, because nothing tells the add which of its endpoints
  // the removal had to rescue — see §16.7. Neither endpoint here is rescued, so
  // this one is exact.
  const handle = load();
  const before = zenkit.normalizeWorld(load());
  const free = indexOf(handle, 'FP_FIXTURE_FREE');
  const a = indexOf(handle, 'WP_FIXTURE_A');

  zenkit.addWaypointEdge(handle, free, 'FP_FIXTURE_FREE', a, 'WP_FIXTURE_A');
  zenkit.removeWaypointEdge(handle, free, 'FP_FIXTURE_FREE', a, 'WP_FIXTURE_A');

  assert.deepStrictEqual(zenkit.normalizeWorld(handle).waynet, before.waynet);
});

test('an added edge survives a save and a reload', () => {
  const handle = load();
  zenkit.addWaypointEdge(
    handle, indexOf(handle, 'FP_FIXTURE_FREE'), 'FP_FIXTURE_FREE',
    indexOf(handle, 'WP_FIXTURE_A'), 'WP_FIXTURE_A'
  );

  const saved = path.join(
    require('node:os').tmpdir(), `zenkit-waynet-edge-add-${process.pid}.zen`
  );
  try {
    zenkit.saveWorld(handle, saved);
    const dump = zenkit.normalizeWorld(zenkit.loadWorld(saved, 'g2'));

    assert.strictEqual(dump.waynet.waypoints.length, 4);
    assert.strictEqual(dump.waynet.edges.length, 4);
    assert.deepStrictEqual(
      dump.waynet.edges.filter((edge) => edge.includes('FP_FIXTURE_FREE')),
      [['FP_FIXTURE_FREE', 'WP_FIXTURE_A']]
    );
  } finally {
    require('node:fs').rmSync(saved, { force: true });
  }
});

// removeWaypoint's barrier direction — an arbitrary waypoint, deleted with its
// edges (level-editor.md §16.7, W4).
//
// The same call as the append's inverse rather than a second one, with the flag
// naming the *reason* it is allowed to do more: a barrier removal has an undo
// stack cleared behind it (§15), so it may take an index in the middle — which
// renumbers every waypoint after it — and may take the edges that name the
// waypoint with it, where undoing an append can do neither.

test('a barrier removal takes a waypoint out of the middle, and its edges with it', () => {
  const handle = load();
  const at = indexOf(handle, 'WP_FIXTURE_A');

  zenkit.removeWaypoint(handle, at, 'WP_FIXTURE_A', true);

  const after = zenkit.normalizeWorld(handle);
  assert.deepStrictEqual(after.waynet.waypoints.map((point) => point.name),
    ['FP_FIXTURE_FREE', 'WP_FIXTURE_B', 'WP_FIXTURE_C']);
  // Both of A's edges go, and the one that does not name it stays. An edge into
  // a waypoint the point list no longer has is what `WayNet::save` would write
  // straight back in — the whole reason the append's inverse refuses instead.
  assert.deepStrictEqual(after.waynet.edges, [['WP_FIXTURE_B', 'WP_FIXTURE_C']]);
  // And the renumbering the barrier pays for: what was index 2 is index 1 now.
  assert.deepStrictEqual(zenkit.getWaynet(handle).names,
    ['FP_FIXTURE_FREE', 'WP_FIXTURE_B', 'WP_FIXTURE_C']);
});

test('a barrier removal leaves the waypoints it keeps untouched', () => {
  const handle = load();
  const before = zenkit.normalizeWorld(load());

  zenkit.removeWaypoint(handle, indexOf(handle, 'WP_FIXTURE_A'), 'WP_FIXTURE_A', true);

  const after = zenkit.normalizeWorld(handle);
  for (const point of after.waynet.waypoints) {
    assert.deepStrictEqual(
      point, before.waynet.waypoints.find((candidate) => candidate.name === point.name)
    );
  }
});

test('a barrier removal promotes an endpoint it leaves in no edge', () => {
  // `RemoveWaypointEdge`'s rescue, owed here for the same reason: `WayNet::save`
  // writes free points plus edge endpoints and nothing else, so a waypoint that
  // is neither is deleted by the writer without a word. Taking A and then B
  // leaves C in no edge at all, and C is not a free point in the fixture.
  const handle = load();
  zenkit.removeWaypoint(handle, indexOf(handle, 'WP_FIXTURE_A'), 'WP_FIXTURE_A', true);
  zenkit.removeWaypoint(handle, indexOf(handle, 'WP_FIXTURE_B'), 'WP_FIXTURE_B', true);

  const dump = zenkit.normalizeWorld(handle);
  assert.deepStrictEqual(dump.waynet.edges, []);
  assert.strictEqual(
    dump.waynet.waypoints.find((point) => point.name === 'WP_FIXTURE_C').freePoint, true
  );

  const saved = path.join(
    require('node:os').tmpdir(), `zenkit-waynet-delete-${process.pid}.zen`
  );
  try {
    zenkit.saveWorld(handle, saved);
    const reloaded = zenkit.normalizeWorld(zenkit.loadWorld(saved, 'g2'));
    assert.deepStrictEqual(reloaded.waynet.waypoints.map((point) => point.name),
      ['FP_FIXTURE_FREE', 'WP_FIXTURE_C']);
    assert.deepStrictEqual(reloaded.waynet.edges, []);
  } finally {
    require('node:fs').rmSync(saved, { force: true });
  }
});

test('a barrier removal survives a save and a reload', () => {
  const handle = load();
  zenkit.removeWaypoint(handle, indexOf(handle, 'WP_FIXTURE_A'), 'WP_FIXTURE_A', true);

  const saved = path.join(
    require('node:os').tmpdir(), `zenkit-waynet-delete-mid-${process.pid}.zen`
  );
  try {
    zenkit.saveWorld(handle, saved);
    const dump = zenkit.normalizeWorld(zenkit.loadWorld(saved, 'g2'));

    assert.deepStrictEqual(dump.waynet.waypoints.map((point) => point.name),
      ['FP_FIXTURE_FREE', 'WP_FIXTURE_B', 'WP_FIXTURE_C']);
    assert.deepStrictEqual(dump.waynet.edges, [['WP_FIXTURE_B', 'WP_FIXTURE_C']]);
  } finally {
    require('node:fs').rmSync(saved, { force: true });
  }
});

test('a barrier removal keeps the index+name guard, and the flag is required', () => {
  // The guard is the one thing the barrier does not buy off: a stale index still
  // resolves to *some* waypoint, and deleting the wrong one is the failure this
  // whole address exists to prevent.
  const handle = load();
  const count = zenkit.getWaynet(handle).count;

  assert.throws(
    () => zenkit.removeWaypoint(handle, indexOf(handle, 'WP_FIXTURE_A'), 'WP_FIXTURE_B', true),
    /changed under this op/
  );
  assert.throws(() => zenkit.removeWaypoint(handle, count, 'WP_FIXTURE_A', true), /no waypoint/);
  // Never defaulted: which of the two removals this is decides whether it may
  // renumber the waynet, and a caller that forgot to say must not get either.
  assert.throws(() => zenkit.removeWaypoint(handle, 0, 'FP_FIXTURE_FREE'), /barrier/);
  assert.strictEqual(zenkit.getWaynet(handle).count, count);
});

// insertWaypoint — the barrier removal run backwards (§7).
//
// The delete stopped being a barrier when it gained this: a waypoint is five
// scalars and a set of edges, so the op can carry the whole of one, and the
// restore lands it back in the slot it came from rather than at the tail. The
// slot is the load-bearing half — every op on the undo stack was made against
// the enumeration the delete changed, so a restore at the tail would put the
// point back and misaddress everything else.

/** The record `zen-world`'s `deleteWaypoint` would build for `name`, read out of
 *  the world before it is deleted — so a delete-then-restore here exercises the
 *  same values the editor's op carries. */
function recordOf(handle, name) {
  const waynet = zenkit.getWaynet(handle);
  const at = waynet.names.indexOf(name);
  const positions = new Float32Array(waynet.positions);
  const directions = new Float32Array(waynet.directions);
  const flags = new Uint32Array(waynet.flags)[at];
  const pairs = new Uint32Array(waynet.edges);

  const edges = [];
  for (let pair = 0; pair < pairs.length; pair += 2) {
    const [left, right] = [pairs[pair], pairs[pair + 1]];
    if (left !== at && right !== at) continue;
    const other = left === at ? right : left;
    edges.push({ waypoint: other, name: waynet.names[other] });
  }

  return {
    waypoint: at,
    record: {
      position: [positions[at * 3], positions[at * 3 + 1], positions[at * 3 + 2]],
      direction: [directions[at * 3], directions[at * 3 + 1], directions[at * 3 + 2]],
      waterDepth: new Int32Array(waynet.waterDepths)[at],
      underWater: (flags & 2) !== 0,
      freePoint: (flags & 1) !== 0,
      edges,
    },
  };
}

test('a delete and its restore leave the waynet exactly as it was', () => {
  // The whole point of the op, and the assertion that would catch every partial
  // restore: the names in order, the edges, and every scalar on every waypoint.
  const handle = load();
  const before = zenkit.normalizeWorld(load());
  const { waypoint, record } = recordOf(handle, 'WP_FIXTURE_A');

  zenkit.removeWaypoint(handle, waypoint, 'WP_FIXTURE_A', true);
  const landed = zenkit.insertWaypoint(handle, waypoint, 'WP_FIXTURE_A', record);

  assert.strictEqual(landed, waypoint);
  const after = zenkit.normalizeWorld(handle);
  assert.deepStrictEqual(after.waynet.waypoints, before.waynet.waypoints);
  // Edge *order* is not restored — the two A edges are rebuilt after the one
  // that never named A — so the set is what is compared, which is what an
  // undirected graph means. The pairs themselves are compared oriented, because
  // the restore puts the returning waypoint first in each and nothing reads an
  // orientation.
  const key = (edges) => edges.map((edge) => [...edge].sort().join('-')).sort();
  assert.deepStrictEqual(key(after.waynet.edges), key(before.waynet.edges));
});

test('a restored waypoint goes back into its own slot, not onto the end', () => {
  // The renumbering undone. A tail restore would pass every test above and leave
  // WP_FIXTURE_B at 1 where every op on the undo stack expects it at 2.
  const handle = load();
  const { waypoint, record } = recordOf(handle, 'WP_FIXTURE_A');

  zenkit.removeWaypoint(handle, waypoint, 'WP_FIXTURE_A', true);
  assert.deepStrictEqual(zenkit.getWaynet(handle).names,
    ['FP_FIXTURE_FREE', 'WP_FIXTURE_B', 'WP_FIXTURE_C']);

  zenkit.insertWaypoint(handle, waypoint, 'WP_FIXTURE_A', record);

  assert.deepStrictEqual(zenkit.getWaynet(handle).names,
    ['FP_FIXTURE_FREE', 'WP_FIXTURE_A', 'WP_FIXTURE_B', 'WP_FIXTURE_C']);
});

test('a restore carries the scalars the record holds, not addWaypoint\'s defaults', () => {
  // `addWaypoint` fixes the direction, the depth and both flags because it is
  // authoring a new point. A restore is handed what the point *was*, and a
  // restore that defaulted any of it would be silently wrong on every retail
  // waypoint that is not a resting free point.
  const handle = load();
  const restored = zenkit.insertWaypoint(handle, 1, 'WP_FIXTURE_D', {
    position: [1.5, 2.5, 3.5],
    direction: [0, 1, 0],
    waterDepth: 400,
    underWater: true,
    freePoint: false,
    edges: [],
  });

  assert.strictEqual(restored, 1);
  const point = zenkit.normalizeWorld(handle).waynet.waypoints
    .find((candidate) => candidate.name === 'WP_FIXTURE_D');
  assert.deepStrictEqual(point.position, [1.5, 2.5, 3.5]);
  assert.deepStrictEqual(point.direction, [0, 1, 0]);
  assert.strictEqual(point.waterDepth, 400);
  assert.strictEqual(point.underWater, true);
  assert.strictEqual(point.freePoint, false);
});

test('a restore rebuilds every edge the record names, in the pre-delete enumeration', () => {
  // The indices on the record are the ones the *delete* was made against, which
  // are one higher than the list the insert is handed for every neighbour past
  // the slot — WP_FIXTURE_B is 2 on the record and 1 in the world when the
  // insert runs. Getting that wrong joins the waypoint to the wrong neighbour
  // rather than failing, which is why it has a test of its own.
  const handle = load();
  const { waypoint, record } = recordOf(handle, 'WP_FIXTURE_A');
  assert.deepStrictEqual(record.edges,
    [{ waypoint: 2, name: 'WP_FIXTURE_B' }, { waypoint: 3, name: 'WP_FIXTURE_C' }]);

  zenkit.removeWaypoint(handle, waypoint, 'WP_FIXTURE_A', true);
  zenkit.insertWaypoint(handle, waypoint, 'WP_FIXTURE_A', record);

  const edges = zenkit.normalizeWorld(handle).waynet.edges
    .map((edge) => [...edge].sort().join('-')).sort();
  assert.deepStrictEqual(edges,
    ['WP_FIXTURE_A-WP_FIXTURE_B', 'WP_FIXTURE_A-WP_FIXTURE_C', 'WP_FIXTURE_B-WP_FIXTURE_C']);
});

test('a restore refuses a slot past the end, an empty name and a name already taken', () => {
  const handle = load();
  const count = zenkit.getWaynet(handle).count;
  const record = { position: [0, 0, 0], direction: [0, 0, 1], waterDepth: 0,
    underWater: false, freePoint: true, edges: [] };

  // One past the end is the append and is legal — a waypoint deleted from the
  // tail is restored to the tail.
  assert.throws(() => zenkit.insertWaypoint(handle, count + 1, 'FP_NEW', record),
    /no waypoint slot/);
  assert.throws(() => zenkit.insertWaypoint(handle, -1, 'FP_NEW', record), /no waypoint slot/);
  assert.throws(() => zenkit.insertWaypoint(handle, 0, '', record), /cannot be empty/);
  assert.throws(() => zenkit.insertWaypoint(handle, 0, 'WP_FIXTURE_A', record),
    /already named/);
  assert.strictEqual(zenkit.getWaynet(handle).count, count);
});

test('a restore refuses an edge whose other end has moved, and inserts nothing', () => {
  // Every endpoint is resolved before the point goes in, so a stale edge refuses
  // the whole restore. The alternative is a waypoint in the list with half its
  // edges, which the next save would write.
  const handle = load();
  const { waypoint, record } = recordOf(handle, 'WP_FIXTURE_A');
  zenkit.removeWaypoint(handle, waypoint, 'WP_FIXTURE_A', true);

  const stale = { ...record, edges: [{ waypoint: 2, name: 'FP_FIXTURE_FREE' }] };
  assert.throws(() => zenkit.insertWaypoint(handle, waypoint, 'WP_FIXTURE_A', stale),
    /changed under this op/);
  assert.throws(
    () => zenkit.insertWaypoint(handle, waypoint, 'WP_FIXTURE_A',
      { ...record, edges: [{ waypoint: 9, name: 'WP_FIXTURE_B' }] }),
    /no waypoint at 9/
  );
  assert.deepStrictEqual(zenkit.getWaynet(handle).names,
    ['FP_FIXTURE_FREE', 'WP_FIXTURE_B', 'WP_FIXTURE_C']);
});

test('a restored waypoint survives a save and a reload, edges intact', () => {
  const handle = load();
  const { waypoint, record } = recordOf(handle, 'WP_FIXTURE_A');
  zenkit.removeWaypoint(handle, waypoint, 'WP_FIXTURE_A', true);
  zenkit.insertWaypoint(handle, waypoint, 'WP_FIXTURE_A', record);

  const saved = path.join(
    require('node:os').tmpdir(), `zenkit-waynet-restore-${process.pid}.zen`
  );
  try {
    zenkit.saveWorld(handle, saved);
    const dump = zenkit.normalizeWorld(zenkit.loadWorld(saved, 'g2'));

    assert.deepStrictEqual(dump.waynet.waypoints.map((point) => point.name),
      ['FP_FIXTURE_FREE', 'WP_FIXTURE_A', 'WP_FIXTURE_B', 'WP_FIXTURE_C']);
    assert.deepStrictEqual(
      dump.waynet.edges.map((edge) => [...edge].sort().join('-')).sort(),
      ['WP_FIXTURE_A-WP_FIXTURE_B', 'WP_FIXTURE_A-WP_FIXTURE_C', 'WP_FIXTURE_B-WP_FIXTURE_C']
    );
  } finally {
    require('node:fs').rmSync(saved, { force: true });
  }
});

test('every waynet mutator marks the handle mutated, so container is null', () => {
  // `container` is computed from the archive BYTES the handle was loaded from,
  // so any mutation must clear it — a waynet op no less than a VOB op. Reporting
  // the pre-edit file's hash table beside a waypoint list that no longer matches
  // it is the lie `classifyDumps` would then attribute to the writer.
  const cases = [
    ['setWaypointPosition', (h) => zenkit.setWaypointPosition(h, indexOf(h, 'WP_FIXTURE_B'), 'WP_FIXTURE_B', [1, 2, 3])],
    ['setWaypointName', (h) => zenkit.setWaypointName(h, indexOf(h, 'WP_FIXTURE_B'), 'WP_FIXTURE_B', 'WP_RENAMED')],
    ['addWaypoint', (h) => zenkit.addWaypoint(h, 'FP_ADDED', [1, 2, 3])],
    ['removeWaypoint', (h) => zenkit.removeWaypoint(h, zenkit.addWaypoint(h, 'FP_ADDED', [1, 2, 3]), 'FP_ADDED', false)],
    ['insertWaypoint', (h) => zenkit.insertWaypoint(h, 0, 'FP_RESTORED', { position: [1, 2, 3], direction: [0, 0, 1], waterDepth: 0, underWater: false, freePoint: true, edges: [] })],
    ['addWaypointEdge', (h) => zenkit.addWaypointEdge(h, indexOf(h, 'FP_FIXTURE_FREE'), 'FP_FIXTURE_FREE', indexOf(h, 'WP_FIXTURE_A'), 'WP_FIXTURE_A')],
    ['removeWaypointEdge', (h) => zenkit.removeWaypointEdge(h, indexOf(h, 'WP_FIXTURE_A'), 'WP_FIXTURE_A', indexOf(h, 'WP_FIXTURE_B'), 'WP_FIXTURE_B')],
  ];

  for (const [name, mutate] of cases) {
    const handle = load();
    assert.notStrictEqual(zenkit.normalizeWorld(handle).container, null, `${name}: fixture has a container`);
    mutate(handle);
    assert.strictEqual(zenkit.normalizeWorld(handle).container, null, `${name} left the source path attached`);
  }
});
