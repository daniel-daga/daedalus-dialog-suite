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
