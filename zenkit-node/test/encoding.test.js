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

// windows-1252 leaves five bytes undefined — 0x81, 0x8D, 0x8F, 0x90, 0x9D — and
// the decoder passes each through as its Latin-1 code point by decision, which
// is what the engine's own fonts show. The encoder had no matching branch, so a
// name carrying one read out of a world and was then refused on the way back
// in: a name the editor displays that no op will accept, and a world that
// cannot be re-saved with the name it was loaded with.
const UNDEFINED_BYTES = [0x81, 0x8d, 0x8f, 0x90, 0x9d];

test('a name carrying an undefined windows-1252 byte survives the round trip', () => {
  for (const byte of UNDEFINED_BYTES) {
    withTmpDir((dir) => {
      // Byte surgery rather than an authored name: authoring one goes through
      // the encoder, which is the half under test. Written in place so the
      // string's own length prefix still describes it.
      const bytes = fs.readFileSync(FIXTURE);
      const at = bytes.indexOf(Buffer.from('WP_FIXTURE_B', 'latin1'));
      assert.ok(at > 0, 'the fixture no longer carries WP_FIXTURE_B');
      bytes[at + 'WP_FIXTURE_'.length] = byte;
      const patched = path.join(dir, `undefined-${byte.toString(16)}.zen`);
      fs.writeFileSync(patched, bytes);

      const handle = zenkit.loadWorld(patched, 'g2');
      const names = zenkit.getWaynet(handle).names;
      const expected = `WP_FIXTURE_${String.fromCharCode(byte)}`;
      const index = names.indexOf(expected);
      assert.ok(index >= 0, `expected ${JSON.stringify(expected)} in ${JSON.stringify(names)}`);

      // The name the world just handed out is the name every waynet op is
      // addressed with, so a name that cannot be encoded cannot be operated on.
      zenkit.setWaypointPosition(handle, index, expected, [4, 5, 6]);
      // By name, not by index: the dump lists every waypoint while `getWaynet`
      // emits the filtered, stored-order list the ops are addressed with.
      const moved = zenkit.normalizeWorld(handle).waynet.waypoints
        .find((waypoint) => waypoint.name === expected);
      assert.ok(moved, 'the dump no longer carries the renamed waypoint');
      assert.deepStrictEqual(moved.position, [4, 5, 6]);

      // And it goes back to the file as the one byte it came in as.
      const out = path.join(dir, 'resaved.zen');
      zenkit.saveWorld(handle, out);
      assert.ok(
        fs.readFileSync(out).includes(Buffer.from(expected, 'latin1')),
        `the name was not written back as byte 0x${byte.toString(16)}`,
      );
    });
  }
});

// The refusal above is still correct for a character windows-1252 genuinely
// cannot hold — but it printed the code point in decimal after a "U+", which
// spells a different, valid code point rather than an obviously wrong number.
test('a code point windows-1252 cannot hold is named in hex, as U+ promises', () => {
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  // Ж is U+0416; in decimal that is 1046, which reads as U+1046 — a real
  // character, and not this one.
  assert.throws(() => zenkit.addWaypoint(handle, 'WP_ЖУК', [1, 2, 3]), /U\+0416/);
});
