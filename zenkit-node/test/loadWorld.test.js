'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

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
