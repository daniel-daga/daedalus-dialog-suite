'use strict';

// CMake pre-step for the two-stage build (docs/plans/level-editor-phase-0.md §4,
// option B): configure and build the vendored ZenKit submodule as a static
// library, then stage the resulting archives under build/zenkit/out/ with
// stable paths so binding.gyp can link them without knowing the generator's
// layout. Also generates build/zenkit/zenkit-version.h from the submodule's
// CMakeLists.txt so the addon reports the actual pinned ZenKit version.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ZENKIT_SRC = path.join(ROOT, 'vendor', 'ZenKit');
// Not under build/ — `node-gyp rebuild` deletes build/ during its clean step.
const BUILD_DIR = path.join(ROOT, 'vendor-build', 'zenkit');
const OUT_DIR = path.join(BUILD_DIR, 'out');

function findCMake() {
  const candidates = ['cmake'];
  if (process.platform === 'win32') {
    const vswhere = path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio', 'Installer', 'vswhere.exe'
    );
    if (fs.existsSync(vswhere)) {
      try {
        const vsRoot = execFileSync(vswhere, ['-latest', '-property', 'installationPath'], {
          encoding: 'utf8',
        }).trim();
        if (vsRoot) {
          candidates.push(path.join(vsRoot,
            'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe'));
        }
      } catch {
        // vswhere failed; fall through to PATH lookup only
      }
    }
  }
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error('cmake not found on PATH or in a Visual Studio installation');
}

function zenkitVersion() {
  const cmakeLists = fs.readFileSync(path.join(ZENKIT_SRC, 'CMakeLists.txt'), 'utf8');
  const match = cmakeLists.match(/project\(ZenKit VERSION ([0-9.]+)\)/);
  if (!match) throw new Error('could not read ZenKit version from vendored CMakeLists.txt');
  return match[1];
}

// Local fixes against the pinned ZenKit commit (upstreamable; see patches/).
// The submodule working tree is reset to the pinned commit first, then every
// patch is applied in order, so a fresh clone and a previously patched tree
// build the same bytes. (Probing each patch with `git apply --reverse --check`
// instead misjudges patches whose hunks overlap — 0003/0007 in Camera.cc.)
function applyPatches() {
  const patchDir = path.join(ROOT, 'patches');
  if (!fs.existsSync(patchDir)) return;
  execFileSync('git', ['checkout', '--', '.'], { cwd: ZENKIT_SRC, stdio: 'inherit' });
  for (const name of fs.readdirSync(patchDir).filter((f) => f.endsWith('.patch')).sort()) {
    execFileSync('git', ['apply', path.join(patchDir, name)], { cwd: ZENKIT_SRC, stdio: 'inherit' });
    console.log(`applied ${name}`);
  }
}

// ZenKit's vendored libsquish adds `-msse2` gated on `BUILD_SQUISH_WITH_SSE2
// AND NOT WIN32` with no architecture check (vendor/libsquish/CMakeLists.txt),
// and the option defaults to ON. On arm64 macOS/Linux that is a hard clang
// error ("unsupported option '-msse2' for target 'arm64-apple-darwin'"), which
// is what failed the macOS CI job. libsquish is a nested submodule of ZenKit,
// so patches/ cannot reach it — the option is turned off from here instead,
// on every non-x86 target.
function configureArgs(platform, arch) {
  const args = [
    '-S', ZENKIT_SRC,
    '-B', BUILD_DIR,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DZK_BUILD_SHARED=OFF',
    '-DZK_BUILD_TESTS=OFF',
    '-DZK_BUILD_EXAMPLES=OFF',
    // ASAN must never ship in a released addon (phase-0 §4).
    '-DZK_ENABLE_ASAN=OFF',
    '-DZK_ENABLE_INSTALL=OFF',
    '-DZK_ENABLE_MMAP=ON',
    // Mods ship compressed VDFs (phase-0 §4); requires the post-v1.3.0 pin.
    '-DZK_ENABLE_ZIPPED_VDF=ON',
    '-DCMAKE_POSITION_INDEPENDENT_CODE=ON',
  ];
  if (arch !== 'x64' && arch !== 'ia32') {
    args.push('-DBUILD_SQUISH_WITH_SSE2=OFF');
  }
  if (platform === 'win32') {
    // node-gyp compiles the addon with the static MSVC runtime (/MT) in
    // Release; ZenKit must match or the final link fails with LNK2038.
    args.push(
      '-DCMAKE_POLICY_DEFAULT_CMP0091=NEW',
      '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded'
    );
  }
  return args;
}

function main() {
  const cmake = findCMake();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  applyPatches();

  const version = zenkitVersion();
  fs.writeFileSync(
    path.join(BUILD_DIR, 'zenkit-version.h'),
    `#pragma once\n#define ZENKIT_NODE_ZENKIT_VERSION "${version}"\n`
  );

  execFileSync(cmake, configureArgs(process.platform, process.arch), { stdio: 'inherit' });
  execFileSync(cmake, ['--build', BUILD_DIR, '--config', 'Release', '--parallel'], {
    stdio: 'inherit',
  });

  // Stage every produced static library into out/ under its plain basename,
  // so binding.gyp has one stable directory to link against on all platforms.
  const staged = new Set();
  const stageLibs = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full !== OUT_DIR) stageLibs(full);
      } else if (/\.(lib|a)$/.test(entry.name) && !staged.has(entry.name)) {
        staged.add(entry.name);
        fs.copyFileSync(full, path.join(OUT_DIR, entry.name));
      }
    }
  };
  stageLibs(BUILD_DIR);
  if (staged.size === 0) throw new Error('ZenKit build produced no static libraries');
  console.log(`zenkit ${version} staged: ${[...staged].join(', ')}`);
}

if (require.main === module) main();

module.exports = { configureArgs };
