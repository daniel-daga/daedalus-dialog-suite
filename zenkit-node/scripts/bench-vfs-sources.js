'use strict';

// What does per-entry provenance cost? (architecture level-editor.md §9; #237,
// and #239 for the retail numbers this is here to produce.)
//
// `vfsList` says which mounted sources hold each entry, and it can only say so
// because `openVfs` mounts every source a second time into a `Vfs` of its own
// and keeps it beside the merged one — ZenKit records no provenance on a merged
// node, so an overridden file is simply gone from the tree. The bytes are
// memory-mapped either way; what the second mount costs is the directory trees.
// The acceptance is "no more than twice the time and memory it takes today", and
// that is a number about a *retail install*, which no fixture and no CI machine
// has. This is the script that produces it.
//
//   node scripts/bench-vfs-sources.js --install "C:/Gothic II" [--mod <path> ...]
//   node scripts/bench-vfs-sources.js <path> [<path> ...]
//
// With `--install` the mount list is the one the editor itself would build
// (`zen-world`'s `gothicAssetSources`, the measured ZenGin load order); bare
// paths are mounted in the order given.
//
// **The baseline is the previous commit.** There is no switch to turn
// provenance off — an option that exists only to be benchmarked is scaffolding —
// so "today" means: check out the commit before per-source mounts landed,
// rebuild the addon, run this, and keep the numbers. Then run it again on this
// commit. The `openVfs` row is what the acceptance compares.

const path = require('node:path');
const v8 = require('node:v8');

const zenkit = require('..');

function parseArgs(argv) {
  const paths = [];
  const mods = [];
  let install = null;
  for (let at = 0; at < argv.length; at += 1) {
    if (argv[at] === '--install') install = argv[++at];
    else if (argv[at] === '--mod') mods.push(argv[++at]);
    else paths.push(argv[at]);
  }
  return { install, mods, paths };
}

/** Resident set after a forced collection, so a reading is the heap that
 *  survives rather than whatever the allocator has not returned yet. */
function settledRss() {
  if (typeof global.gc === 'function') global.gc();
  return process.memoryUsage().rss;
}

function measure(what, run) {
  const before = settledRss();
  const started = process.hrtime.bigint();
  const value = run();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const rss = settledRss() - before;
  console.log(`${what.padEnd(46)} ${ms.toFixed(1).padStart(9)} ms  ${(rss / 1024 / 1024).toFixed(1).padStart(8)} MB`);
  return value;
}

/** The biggest directory one level down — the listing whose per-entry
 *  provenance lookup costs the most. */
function widestDirectory(handle) {
  let widest = { path: '/', entries: zenkit.vfsList(handle, '/') ?? [] };
  for (const entry of widest.entries) {
    if (entry.type !== 'directory') continue;
    const entries = zenkit.vfsList(handle, entry.name) ?? [];
    if (entries.length > widest.entries.length) widest = { path: entry.name, entries };
  }
  return widest;
}

function main() {
  const { install, mods, paths } = parseArgs(process.argv.slice(2));

  let sources = paths;
  if (install !== null) {
    // Required lazily: this is the one place the binding's scripts reach into a
    // sibling workspace, and a bare-path run must not depend on it building.
    const { gothicAssetSources } = require('zen-world');
    const fs = require('node:fs');
    sources = gothicAssetSources(install.replace(/\\/g, '/'), (candidate) => fs.existsSync(candidate), mods)
      .map((candidate) => path.normalize(candidate));
  }
  if (sources.length === 0) {
    console.error('nothing to mount: pass --install <dir> or one or more paths');
    process.exitCode = 1;
    return;
  }

  console.log(`${sources.length} sources, in mount order:`);
  for (const [at, source] of sources.entries()) console.log(`  [${at}] ${source}`);
  console.log(`\nheap limit ${(v8.getHeapStatistics().heap_size_limit / 1024 / 1024).toFixed(0)} MB`);
  console.log(`\n${''.padEnd(46)}${'time'.padStart(12)}${'rss'.padStart(12)}`);

  const handle = measure('openVfs (merged + one per source)', () => zenkit.openVfs(sources, { overwrite: 'all' }));

  measure('vfsList /', () => zenkit.vfsList(handle, '/'));
  const widest = widestDirectory(handle);
  measure(`vfsList ${widest.path} (${widest.entries.length} entries)`, () => zenkit.vfsList(handle, widest.path));

  // What the facet is for: how much of the install is shadowed at all. A
  // listing where nothing is overridden is one where the browser has nothing to
  // shade, and that is worth knowing before the UI is judged.
  const shadowed = widest.entries.filter((entry) => entry.sources.length > 1).length;
  console.log(`\n${shadowed} of ${widest.entries.length} entries in ${widest.path} are held by more than one source`);

  for (const [at, source] of sources.entries()) {
    measure(`  [${at}] alone`, () => zenkit.openVfs([source], { overwrite: 'all' }));
  }
}

main();
