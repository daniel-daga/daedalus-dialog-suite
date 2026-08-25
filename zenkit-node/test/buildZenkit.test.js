'use strict';

// The CMake pre-step's configure arguments. ZenKit's vendored libsquish adds
// `-msse2` on any non-Windows target with no architecture check, which is a
// hard clang error on arm64 and is what failed the macOS CI job (T9,
// docs/engine-acceptance-2026-08-25.md §9). libsquish is a nested submodule of
// ZenKit, so patches/ cannot reach it; the option is turned off from the build
// script instead.

const test = require('node:test');
const assert = require('node:assert');

const { configureArgs } = require('../scripts/build-zenkit');

const SSE2_OFF = '-DBUILD_SQUISH_WITH_SSE2=OFF';

test('configureArgs disables libsquish SSE2 on arm64 macOS', () => {
  assert.ok(configureArgs('darwin', 'arm64').includes(SSE2_OFF));
});

test('configureArgs disables libsquish SSE2 on arm64 Linux', () => {
  assert.ok(configureArgs('linux', 'arm64').includes(SSE2_OFF));
});

test('configureArgs leaves libsquish SSE2 alone on x86 targets', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const arch of ['x64', 'ia32']) {
      assert.ok(
        !configureArgs(platform, arch).includes(SSE2_OFF),
        `${platform}/${arch} should keep libsquish's SSE2 default`
      );
    }
  }
});

// Regression guard: the addon links /MT in Release, so ZenKit must match or the
// final link fails with LNK2038.
test('configureArgs pins the static MSVC runtime on Windows only', () => {
  const runtime = '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded';
  assert.ok(configureArgs('win32', 'x64').includes(runtime));
  assert.ok(!configureArgs('linux', 'x64').includes(runtime));
});
