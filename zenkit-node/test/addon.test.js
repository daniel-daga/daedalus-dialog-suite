'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('addon loads and reports the linked ZenKit version', () => {
  const zenkit = require('..');
  assert.strictEqual(typeof zenkit.zenkitVersion, 'string');
  // The submodule is pinned to a release tag; the version is read from the
  // vendored CMakeLists.txt at build time, so this asserts the actual pin.
  assert.match(zenkit.zenkitVersion, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(zenkit.zenkitVersion, '1.3.0');
});
