'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const zenkit = require('..');

test('ASCII booleans keep ZenGin signed bit-field values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-ascii-bool-'));
  try {
    const at = path.join(dir, 'unpacked.zen');
    zenkit._authorFixtureWorld(at, 'ascii', 'g2', 'minimal', false);

    const lines = fs
      .readFileSync(at, 'latin1')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes('=bool:'));

    assert.ok(lines.includes('locked=bool:-1'));
    assert.ok(lines.includes('moveable=bool:-1'));
    assert.ok(lines.includes('focusOverride=bool:-1'));
    assert.ok(lines.includes('showVisual=bool:1'));
    assert.ok(lines.includes('takeable=bool:0'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
