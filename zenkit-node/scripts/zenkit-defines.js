#!/usr/bin/env node
'use strict';

// Prints the ABI-affecting compile definitions the vendored ZenKit was ACTUALLY
// built with, for binding.gyp to expand with `<!@()`.
//
// ZenKit attaches several of its build options to its CMake target as PUBLIC
// compile definitions. Two of them change the layout of types the addon holds
// by value — `_ZK_WITH_MMAP` adds `Vfs::_m_data_mapped`. Because the addon is
// compiled by node-gyp rather than CMake, it never sees them unless they are
// passed explicitly, and it then compiles a SMALLER `zenkit::Vfs` than the
// library it links against. `Vfs::Vfs()` initialises the extra member past the
// end of the addon's allocation: heap corruption that surfaces much later and
// nowhere near the cause.
//
// The values come from scripts/build-zenkit.js, which records what CMake
// reported it enabled — not what was requested. `-DZK_ENABLE_MMAP=ON` is only
// a request; ZenKit also probes the platform for mmap support and silently
// leaves the feature off when it is missing.

const fs = require('node:fs');
const path = require('node:path');

const ABI_FILE = path.join(__dirname, '..', 'vendor-build', 'zenkit', 'zenkit-abi.json');

function zenkitDefines() {
  if (!fs.existsSync(ABI_FILE)) {
    throw new Error(
      `${ABI_FILE} is missing — run \`node scripts/build-zenkit.js\` before node-gyp. ` +
        'Building the addon against ZenKit headers without the definitions the library ' +
        'was compiled with produces a mismatched Vfs layout and corrupts the heap.'
    );
  }

  const defines = JSON.parse(fs.readFileSync(ABI_FILE, 'utf8'));
  if (!Array.isArray(defines) || defines.some((d) => typeof d !== 'string')) {
    throw new Error(`${ABI_FILE} is not a list of compile definitions`);
  }
  return defines;
}

if (require.main === module) {
  process.stdout.write(zenkitDefines().join(' '));
}

module.exports = { zenkitDefines, ABI_FILE };
