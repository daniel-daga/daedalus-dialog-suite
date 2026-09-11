'use strict';

// What does the asset browser's top level actually look like on a real Gothic
// install? (#245, and the triage step #241 needs before its search is judged.)
//
// `gothicAssetSources` mounts each loose `_compiled` tree at the root of the
// merged namespace, so those files are flat by construction. What the six
// retail VDFs contribute has never been looked at in this repo, and the first
// outside user's report — "in browse I can't really navigate into folders" —
// is either accurate or a UI problem depending on the answer. No CI runner has
// a Gothic install, so this is a script somebody runs on a machine that does.
//
//   node scripts/describe-vfs-root.js --install "C:/Gothic II" [--mod <path> ...]
//   node scripts/describe-vfs-root.js <path> [<path> ...] [--find NAME]
//
// It prints three things:
//
//   1. the top level, counted — folders against files. One flat listing of tens
//      of thousands of files means "cannot navigate into folders" is simply
//      what the namespace is, and no navigation change helps.
//   2. the shape below it — how deep it goes and where the entries actually
//      live, which is what says whether a search has to be an index over the
//      whole namespace or a filter over one listing.
//   3. whether the names Florian could not find are mounted at all
//      (`--find`, defaulting to the two he named). A tile marked unavailable in
//      Categories means a short mount list, which is a different bug from a
//      missing search — and the catalogue ships 1,396 names regardless of what
//      a given install contains, so the catalogue proves nothing by itself.

const path = require('node:path');

const zenkit = require('..');

/** The names the report is about unless the caller names others — the two from
 *  the original report, verbatim. */
const DEFAULT_NEEDLES = ['GRASSGROUP', 'FENCE'];

function parseArgs(argv) {
  const paths = [];
  const mods = [];
  const needles = [];
  let install = null;
  for (let at = 0; at < argv.length; at += 1) {
    if (argv[at] === '--install') install = argv[++at];
    else if (argv[at] === '--mod') mods.push(argv[++at]);
    else if (argv[at] === '--find') needles.push(argv[++at]);
    else paths.push(argv[at]);
  }
  return { install, mods, paths, needles: needles.length === 0 ? DEFAULT_NEEDLES : needles };
}

/**
 * Walk the whole namespace, counting. Breadth-first and one level at a time,
 * which is the only thing `vfsList` offers — the point of the script is to find
 * out how big that walk is, so it does it once and says.
 */
function shape(handle) {
  const perDepth = [];
  let files = 0;
  let directories = 0;
  let widest = { path: '/', entries: 0 };

  let frontier = ['/'];
  for (let depth = 0; frontier.length > 0; depth += 1) {
    const next = [];
    let atDepth = 0;
    for (const directory of frontier) {
      const entries = zenkit.vfsList(handle, directory) ?? [];
      atDepth += entries.length;
      if (entries.length > widest.entries) widest = { path: directory, entries: entries.length };
      for (const entry of entries) {
        if (entry.type !== 'directory') { files += 1; continue; }
        directories += 1;
        next.push(directory === '/' ? entry.name : `${directory}/${entry.name}`);
      }
    }
    perDepth.push(atDepth);
    frontier = next;
  }

  return { files, directories, perDepth, widest };
}

function main() {
  const { install, mods, paths, needles } = parseArgs(process.argv.slice(2));

  let sources = paths;
  if (install !== null) {
    // Lazily, as `bench-vfs-sources.js` does: a bare-path run must not depend
    // on the sibling workspace having been built.
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

  const handle = zenkit.openVfs(sources, { overwrite: 'all' });

  // 1. The top level — the listing Browse opens on, and the one the report is
  //    about.
  const root = zenkit.vfsList(handle, '/') ?? [];
  const topDirectories = root.filter((entry) => entry.type === 'directory');
  console.log(`\ntop level: ${topDirectories.length} folders, ${root.length - topDirectories.length} files`);
  for (const entry of topDirectories) console.log(`  ${entry.name}/`);

  // 2. The shape below it.
  const { files, directories, perDepth, widest } = shape(handle);
  console.log(`\nwhole namespace: ${files} files in ${directories} directories, ${perDepth.length} levels deep`);
  console.log(`entries per level: ${perDepth.join(', ')}`);
  console.log(`widest directory: ${widest.path} (${widest.entries} entries)`);

  // 3. Whether the names from the report are there at all.
  console.log('');
  for (const needle of needles) {
    const found = zenkit.vfsFind(handle, needle, { limit: 20 });
    const more = found.truncated ? ' (first 20)' : '';
    console.log(`"${needle}": ${found.matches.length} matches${more}`);
    for (const match of found.matches) {
      console.log(`  ${match.directory === '/' ? '' : `${match.directory}/`}${match.name}`);
    }
  }
}

main();
