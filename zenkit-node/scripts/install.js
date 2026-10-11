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

// In CI, only the path-filtered zenkit-node workflow needs the addon; every
// other job's root `pnpm install` must not pay for a C++ build. Locally the
// source build always runs.
if (process.env.CI && process.env.ZENKIT_NODE_FORCE_BUILD !== '1') {
  console.log('zenkit-node: no prebuild and CI without ZENKIT_NODE_FORCE_BUILD=1 — skipping source build');
  process.exit(0);
}

execFileSync(process.execPath, [path.join(__dirname, 'build-zenkit.js')], { stdio: 'inherit' });
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js', { paths: [ROOT] });
execFileSync(process.execPath, [nodeGyp, 'rebuild'], { stdio: 'inherit', cwd: ROOT });
