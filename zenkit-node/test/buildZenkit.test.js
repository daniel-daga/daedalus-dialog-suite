'use strict';

// The CMake pre-step's configure arguments. ZenKit's vendored libsquish adds
// `-msse2` on any non-Windows target with no architecture check, which is a
// hard clang error on arm64 and is what failed the macOS CI job (T9,
// docs/engine-acceptance-2026-08-25.md §9). libsquish is a nested submodule of
// ZenKit, so patches/ cannot reach it; the option is turned off from the build
// script instead.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

// Regression guard for the mismatched-ABI class of bug. ZenKit attaches some
// build options to its CMake target as PUBLIC compile definitions, and
// `_ZK_WITH_MMAP` adds a member to `zenkit::Vfs`. node-gyp does not build
// through CMake, so unless binding.gyp passes those definitions the addon
// compiles a SMALLER Vfs than the library it links: `Vfs::Vfs()` then writes
// past the end of the addon's allocation and corrupts the heap, surfacing far
// from the cause (0xC0000374 / 0xC0000005 on the second mount, no diagnostic).
//
// Comparing the two sides is what makes this measurable rather than assumed:
// `zenkitAbi` is what the addon was compiled with, zenkit-abi.json is what
// CMake reported it actually enabled when building the library.
test('the addon is compiled with the same ZenKit ABI definitions as the library', () => {
  const { zenkitDefines, ABI_FILE } = require('../scripts/zenkit-defines');
  if (!fs.existsSync(ABI_FILE)) {
    assert.fail(`${ABI_FILE} is missing — run scripts/build-zenkit.js before node-gyp`);
  }

  const addon = require('..').zenkitAbi;
  assert.ok(Array.isArray(addon), 'the addon must report the definitions it was built with');
  assert.deepStrictEqual(
    [...addon].sort(),
    [...zenkitDefines()].sort(),
    'addon and vendored ZenKit disagree on ABI-affecting definitions; rebuild with ' +
      '`node scripts/build-zenkit.js && npx node-gyp rebuild`'
  );
});

// The layout mismatch above only ever showed up on the SECOND mount, so the
// guard has to actually mount twice rather than just construct a Vfs.
test('a VFS survives mounting two sources that share filenames', () => {
  const zenkit = require('..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-vfs-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'zenkit-vfs-'));
  try {
    fs.writeFileSync(path.join(dir, 'COLLIDE.MRM'), 'first');
    fs.writeFileSync(path.join(other, 'COLLIDE.MRM'), 'second-and-longer');

    const vfs = zenkit.openVfs([dir, other]);
    assert.strictEqual(zenkit.vfsResolve(vfs, 'COLLIDE.MRM'), 'COLLIDE.MRM');
  } finally {
    // Best-effort: a live VFS keeps every mounted file memory-mapped, and
    // Windows refuses to delete a mapped file (EPERM). The handle is only
    // released when it is garbage-collected, which this test cannot force.
    for (const d of [dir, other]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // still mapped; the OS temp directory reclaims it
      }
    }
  }
});
