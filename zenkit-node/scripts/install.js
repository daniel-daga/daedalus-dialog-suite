'use strict';

// Install hook: use a prebuild when one matches (node-gyp-build resolution),
// otherwise run the two-stage build (CMake pre-step + node-gyp), keeping
// contributors without a C++ toolchain on prebuilds — phase-0 §4, option B.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

try {
  require('node-gyp-build')(ROOT);
  process.exit(0);
} catch {
  // no usable prebuild — fall through to a source build
}

execFileSync(process.execPath, [path.join(__dirname, 'build-zenkit.js')], { stdio: 'inherit' });
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js', { paths: [ROOT] });
execFileSync(process.execPath, [nodeGyp, 'rebuild'], { stdio: 'inherit', cwd: ROOT });
