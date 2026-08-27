'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const zenkit = require('..');

const FIXTURE = path.join(__dirname, 'fixtures', 'minimal.g2.zen');

test('loadWorld loads the golden fixture and reports exact stats', () => {
  const handle = zenkit.loadWorld(FIXTURE, 'g2');
  const stats = zenkit.worldStats(handle);
  assert.deepStrictEqual(stats, {
    vobCount: 5,
    waypointCount: 4,
    meshVertexCount: 4,
  });
});

test('loadWorld with the wrong game version fails loudly, naming both versions', () => {
  assert.throws(
    () => zenkit.loadWorld(FIXTURE, 'g1'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /version/i);
      assert.match(err.message, /g1/i);
      assert.match(err.message, /g2/i);
      return true;
    }
  );
});

test('loadWorld with a nonexistent path throws', () => {
  assert.throws(() => zenkit.loadWorld(path.join(__dirname, 'fixtures', 'does-not-exist.zen'), 'g2'));
});

test('loadWorld rejects an invalid gameVersion argument', () => {
  assert.throws(() => zenkit.loadWorld(FIXTURE, 'g3'));
});

test('loadWorld turns a ZenKit parse failure into a JS error rather than killing the process', () => {
  // The distinction every other throwing test here misses. All of them trip a
  // check the *binding* makes and get a `Napi::Error`; this one gets past the
  // binding and makes **ZenKit** throw, which is a different exception crossing
  // the same catch.
  //
  // It used to abort the process with 0xC0000409 — `std::terminate` by way of
  // `__fastfail`, because node-gyp compiles every addon TU with
  // `_HAS_EXCEPTIONS=0`, under which MSVC aliases `std::exception` to
  // `stdext::exception` and never declares the real one. `catch (std::exception
  // const&)` in binding.cc then names a type no ZenKit exception derives from,
  // no handler matches, and the whole process dies — taking the editor's
  // zenkit.worker with it for any malformed or truncated world.
  const garbage = path.join(os.tmpdir(), `zenkit-not-a-world-${process.pid}.zen`);
  fs.writeFileSync(garbage, 'not a zen at all');
  try {
    assert.throws(
      () => zenkit.loadWorld(garbage, 'g2'),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /failed to load world/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(garbage, { force: true });
  }
});
