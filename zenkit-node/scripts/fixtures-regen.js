'use strict';

// Regenerates the checked-in golden fixtures (phase-0 §2 C2).
//
// Regenerating a golden is an EXPLICIT, REVIEWED act: run
// `npm run fixtures:regen`, inspect the diff, and re-verify the expected
// values in the tests by hand. Nothing else regenerates fixtures, ever — an
// auto-regenerating golden silently ratifies whatever bug just landed.

const fs = require('node:fs');
const path = require('node:path');

const zenkit = require('..');

const FIXTURE_DIR = path.join(__dirname, '..', 'test', 'fixtures');
fs.mkdirSync(FIXTURE_DIR, { recursive: true });

const fixture = path.join(FIXTURE_DIR, 'minimal.g2.zen');
zenkit._authorFixtureWorld(fixture, 'binsafe', 'g2');

// Sanity check: ZenKit must be able to re-load what it just wrote.
const handle = zenkit.loadWorld(fixture, 'g2');
const stats = zenkit.worldStats(handle);
console.log(`wrote ${fixture}`);
console.log(`stats: ${JSON.stringify(stats)}`);
