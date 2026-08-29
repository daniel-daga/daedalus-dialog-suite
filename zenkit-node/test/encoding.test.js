'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const zenkit = require('..');

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');

test('VOB names cross the boundary as windows-1252, decoded to real characters', () => {
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  const names = zenkit.vobNames(handle);

  assert.ok(Array.isArray(names));
  assert.ok(names.every((n) => typeof n === 'string'));

  // The VSpot's name carries umlauts; they must arrive as the real characters,
  // not as mojibake ("Ã„", "Ã–", …) and not as replacement characters.
  assert.ok(names.includes('FP_CAMPFIRE_ÄÖÜ_01'), `expected umlaut name in ${JSON.stringify(names)}`);
  for (const name of names) {
    assert.ok(!name.includes('Ã'), `mojibake detected in ${JSON.stringify(name)}`);
    assert.ok(!name.includes('�'), `replacement character detected in ${JSON.stringify(name)}`);
  }
});

// Waypoint names cross the same boundary as VOB names and are the same
// windows-1252 bytes — but every waypoint op used to read its `name` argument
// as UTF-8 while `getWaynet` emitted cp1252-decoded names. The three harms are
// pinned below: a name read back from the world no longer addresses its own
// waypoint, a written name does not round-trip through the file, and the
// duplicate refusal compares two different encodings and misses a collision.
// The fixture's four waypoints are all ASCII, so every test here authors the
// non-ASCII name it needs.

const fs = require('node:fs');
const os = require('node:os');

const UMLAUT = 'WP_KÖNIG_ÄÖÜ';

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-node-encoding-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a waypoint name getWaynet emits still addresses its own waypoint', () => {
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  const at = zenkit.addWaypoint(handle, UMLAUT, [1, 2, 3]);

  const names = zenkit.getWaynet(handle).names;
  assert.strictEqual(names[at], UMLAUT, `expected the authored name back, got ${JSON.stringify(names[at])}`);

  // The index+name pair is every waynet op's address, and the name half comes
  // straight from the list above. A mismatch here is the "the waynet has
  // changed under this op" refusal for a waynet that did not change.
  zenkit.setWaypointPosition(handle, at, names[at], [4, 5, 6]);
  const moved = zenkit.normalizeWorld(handle).waynet.waypoints[at];
  assert.strictEqual(moved.name, UMLAUT);
  assert.deepStrictEqual(moved.position, [4, 5, 6]);

  // And the refusal that names the waypoint the caller actually meant spells
  // it the way the caller wrote it — an error message is read, not compared.
  assert.throws(
    () => zenkit.setWaypointPosition(handle, at, 'WP_FIXTURE_B', [0, 0, 0]),
    new RegExp(`is ${UMLAUT}, not WP_FIXTURE_B`),
  );
});

test('an authored waypoint name round-trips through the file as windows-1252', () => {
  withTmpDir((dir) => {
    const handle = zenkit.loadWorld(FIXTURE, 'g2');
    zenkit.addWaypoint(handle, UMLAUT, [1, 2, 3]);
    const out = path.join(dir, 'named.zen');
    zenkit.saveWorld(handle, out);

    // One byte per umlaut in the file, not the two UTF-8 would write.
    const bytes = fs.readFileSync(out);
    assert.ok(
      bytes.includes(Buffer.from('WP_K\xd6NIG_\xc4\xd6\xdc', 'latin1')),
      'the name was not written as windows-1252 bytes',
    );

    const reloaded = zenkit.loadWorld(out, 'g2');
    assert.ok(zenkit.getWaynet(reloaded).names.includes(UMLAUT));

    // The duplicate refusal compares the argument against the names the world
    // holds; in two encodings it misses the collision the by-name script
    // lookup depends on.
    assert.throws(
      () => zenkit.addWaypoint(reloaded, UMLAUT, [7, 8, 9]),
      /already named/,
    );
  });
});

test('a waypoint name windows-1252 cannot represent is refused, not mangled', () => {
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  assert.throws(() => zenkit.addWaypoint(handle, 'WP_ЖУК', [1, 2, 3]), /windows-1252/);
});
