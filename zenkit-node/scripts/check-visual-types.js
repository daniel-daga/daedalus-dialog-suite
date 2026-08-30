'use strict';

// Which visual class does retail attach to which file extension?
// (level-editor.md §14.1 1.7.)
//
// `setVobProp.visual` renames a visual in place and never re-types it, because
// the class of the visual object is not implied by the file name. That claim
// is the reason visual *assignment* is unscheduled, and until now it rested on
// a table nobody could re-run. This is the script behind it: it tabulates
// extension × visual class over the extracted world corpus, and reports the
// `UNKNOWN` share — the VOBs that have no visual object to rename at all, and
// which the binding therefore refuses.
//
// The columns come from `vobIndex`, which interns both the visual name and its
// class, so the walk is two index arrays and no per-VOB allocation.
//
//   node scripts/check-visual-types.js [--world <a.zen> ...]
//
// With no `--world` it reads the three retail worlds out of `worlds/`, which is
// what the 41,393 figure quoted elsewhere means by "retail". That directory is
// gitignored and rebuilt by `scripts/extract-worlds.js` from an installation,
// so this is developer-local; nothing in CI runs it. The tabulation itself is
// pure and covered by `test/visualTypes.test.js`.

const fs = require('node:fs');
const path = require('node:path');

/** The three worlds the retail measurements in the docs are taken over. */
const RETAIL_WORLDS = ['NEWWORLD.ZEN', 'OLDWORLD.ZEN', 'ADDONWORLD.ZEN'];

/**
 * The upper-cased extension of a visual name, or null when there is none —
 * which is what a VOB with no visual holds (an empty name), and is reported as
 * its own row rather than folded into any extension.
 */
function visualExtension(name) {
  const at = name.lastIndexOf('.');
  if (at < 0 || at === name.length - 1) return null;
  return name.slice(at).toUpperCase();
}

/**
 * Counts every VOB of a `vobIndex` under its visual's extension and the class
 * ZenKit gave that visual. Accumulates into `tally` when one is passed, so a
 * corpus of worlds makes one table.
 */
function tallyVisualTypes(index, tally = { total: 0, byExtension: new Map() }) {
  const visualIndex = new Uint32Array(index.visualIndex);
  const visualTypeIndex = new Uint32Array(index.visualTypeIndex);

  for (let at = 0; at < index.count; at += 1) {
    const extension = visualExtension(index.visuals[visualIndex[at]]);
    const type = index.visualTypes[visualTypeIndex[at]];

    let types = tally.byExtension.get(extension);
    if (types === undefined) { types = new Map(); tally.byExtension.set(extension, types); }
    types.set(type, (types.get(type) ?? 0) + 1);
    tally.total += 1;
  }

  return tally;
}

/** The extensions carrying more than one visual class — the ones a rule deriving
 *  the class from the name would get wrong. */
function ambiguousExtensions(tally) {
  return [...tally.byExtension]
    .filter(([extension, types]) => extension !== null && types.size > 1)
    .map(([extension]) => extension);
}

function parseArgs(argv) {
  const worlds = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--world') worlds.push(argv[i + 1]);
  }
  if (worlds.length > 0) return worlds;

  const dir = path.join(__dirname, '..', 'worlds');
  const missing = RETAIL_WORLDS.filter((name) => !fs.existsSync(path.join(dir, name)));
  if (missing.length > 0) {
    throw new Error(`missing from worlds/: ${missing.join(', ')} — run scripts/extract-worlds.js`);
  }
  return RETAIL_WORLDS.map((name) => path.join(dir, name));
}

function main() {
  const zenkit = require('..');
  const worlds = parseArgs(process.argv.slice(2));

  const tally = { total: 0, byExtension: new Map() };
  for (const world of worlds) {
    tallyVisualTypes(zenkit.vobIndex(zenkit.loadWorld(world, 'g2')), tally);
  }

  const rows = [...tally.byExtension].sort((a, b) => {
    const sum = (types) => [...types.values()].reduce((x, y) => x + y, 0);
    return sum(b[1]) - sum(a[1]);
  });

  console.log(`\n${worlds.map((w) => path.basename(w)).join(', ')} — ${tally.total} VOBs\n`);
  console.log(`  ${'extension'.padEnd(12)}visual classes`);
  for (const [extension, types] of rows) {
    const classes = [...types]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type} x${count}`)
      .join('   ');
    const ambiguous = extension !== null && types.size > 1 ? '   ** ambiguous' : '';
    console.log(`  ${(extension ?? '(none)').padEnd(12)}${classes}${ambiguous}`);
  }

  const unknown = [...tally.byExtension.values()]
    .reduce((sum, types) => sum + (types.get('UNKNOWN') ?? 0), 0);
  console.log(`\n  UNKNOWN — no visual object to rename: ${unknown} of ${tally.total}`
    + ` (${(100 * unknown / tally.total).toFixed(1)} %)`);
  console.log(`  ambiguous extensions: ${ambiguousExtensions(tally).join(', ') || '(none)'}\n`);
}

module.exports = { visualExtension, tallyVisualTypes, ambiguousExtensions, RETAIL_WORLDS };

if (require.main === module) main();
