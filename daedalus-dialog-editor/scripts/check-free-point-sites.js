'use strict';

// How many retail `Wld_IsFPAvailable`/`AI_GotoFP` sites resolve against a
// world's `zCVobSpot` set? (world-editor review 2026-08-29, finding 6,
// *Forward*.)
//
// Finding 6 established that a free point is a `zCVobSpot` VOB and that both
// the Problems rule and the jump button now answer through one `worldHasPoint`
// — but only for the sites `extractWaypointSites` collects, which are the
// spawn and routine externals. The two fragment-taking externals never reach
// the index at all, and whether they should is a widening nobody owns. This is
// the number that decision wants: of the sites, how many name a spot the open
// world actually has.
//
// The matching is `worldHasPoint`'s, split into its three strengths so the
// widening can be judged on more than a pass rate: `exact` needs no substring
// rule at all, `prefix` would survive the older `startsWith`, and `infix` is
// what only the engine's own substring search reaches.
//
//   npm run build:main   # not needed — this reads the sources as text
//   node scripts/check-free-point-sites.js --project "<...>\mdk\Content" \
//        --world ../zenkit-node/worlds/NEWWORLD.ZEN
//
// Developer-local: it needs a script corpus and an extracted world. Nothing in
// CI runs it.

const fs = require('node:fs');
const path = require('node:path');

const FREE_POINT_CLASS = 'zCVobSpot';
const EXTERNALS = ['Wld_IsFPAvailable', 'AI_GotoFP'];

/**
 * The source with its comments blanked and its newlines kept, so an offset
 * still gives the line it came from. String bodies survive — they are what is
 * being read — which is what separates this from `check-spawn-occupancy.js`'s
 * `countSpawnCalls`, where a string is only a place a `//` does not start a
 * comment.
 */
function stripComments(source) {
  let out = '';
  let state = 'code'; // code | line | block | string
  for (let i = 0; i < source.length; i += 1) {
    const two = source.substr(i, 2);
    const ch = source[i];
    if (state === 'code') {
      if (two === '//') { state = 'line'; i += 1; out += '  '; }
      else if (two === '/*') { state = 'block'; i += 1; out += '  '; }
      else { if (ch === '"') state = 'string'; out += ch; }
    } else if (state === 'string') {
      if (ch === '"') state = 'code';
      out += ch;
    } else if (state === 'line') {
      if (ch === '\n') { state = 'code'; out += '\n'; } else out += ' ';
    } else {
      if (two === '*/') { state = 'code'; i += 1; out += '  '; }
      else out += ch === '\n' ? '\n' : ' ';
    }
  }
  return out;
}

/**
 * Every call to either external in a source, in order. `name` is the second
 * argument when it is a string literal and `null` when it is anything else —
 * a constant or a variable is still a site, and dropping it would understate
 * the denominator the measurement is a fraction of.
 */
function extractFreePointSites(source, filePath) {
  const code = stripComments(source);
  const pattern = /\b(Wld_IsFPAvailable|AI_GotoFP)\s*\(([^)]*)\)/gi;
  const sites = [];
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const external = EXTERNALS.find((name) => name.toLowerCase() === match[1].toLowerCase());
    const second = match[2].split(',')[1];
    const literal = second ? /^\s*"([^"]*)"\s*$/.exec(second) : null;
    sites.push({
      external,
      name: literal ? literal[1] : null,
      literal: literal !== null,
      filePath,
      line: code.slice(0, match.index).split('\n').length
    });
  }
  return sites;
}

/**
 * How the sites land against a world's free points, `worldHasPoint`'s rule
 * split by strength. Counted per **site**, not per distinct name: the question
 * is how much retail code the widening would reach.
 */
function resolveFreePointSites(sites, freePointNames) {
  const points = freePointNames.map((name) => name.toUpperCase());
  const result = {
    sites: sites.length,
    literal: 0,
    nonLiteral: 0,
    exact: 0,
    prefix: 0,
    infix: 0,
    unresolved: 0,
    unresolvedNames: []
  };

  for (const site of sites) {
    if (!site.literal || !site.name) { result.nonLiteral += 1; continue; }
    result.literal += 1;
    const upper = site.name.toUpperCase();
    if (points.some((point) => point === upper)) result.exact += 1;
    else if (points.some((point) => point.startsWith(upper))) result.prefix += 1;
    else if (points.some((point) => point.includes(upper))) result.infix += 1;
    else {
      result.unresolved += 1;
      result.unresolvedNames.push(site.name);
    }
  }
  return result;
}

function parseArgs(argv) {
  let project = null;
  const worlds = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') project = argv[i + 1];
    if (argv[i] === '--world') worlds.push(argv[i + 1]);
  }
  if (!project || worlds.length === 0) {
    throw new Error('usage: check-free-point-sites.js --project <script tree> --world <a.zen> [--world <b.zen> ...]');
  }
  return { project, worlds };
}

function collectScripts(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith('.d')) files.push(full);
    }
  };
  walk(root);
  return files;
}

/** The named `zCVobSpot` VOBs of a world, which is `freePointsOf`'s set. */
function freePointsOfWorld(worldPath) {
  const zenkit = require('zenkit-node');
  const handle = zenkit.loadWorld(worldPath, 'g2');
  const index = zenkit.vobIndex(handle);
  const spotClass = index.classes.indexOf(FREE_POINT_CLASS);
  if (spotClass < 0) return [];
  const classIndex = new Uint32Array(index.classIndex);
  const nameIndex = new Uint32Array(index.nameIndex);
  const names = new Set();
  for (let vob = 0; vob < index.count; vob += 1) {
    if (classIndex[vob] !== spotClass) continue;
    const name = index.names[nameIndex[vob]];
    if (name) names.add(name.toUpperCase());
  }
  return [...names];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sites = [];
  for (const file of collectScripts(args.project)) {
    sites.push(...extractFreePointSites(fs.readFileSync(file, 'latin1'), file));
  }

  const byExternal = (name) => sites.filter((site) => site.external === name).length;
  console.log(`sites: ${sites.length} (Wld_IsFPAvailable ${byExternal('Wld_IsFPAvailable')}, AI_GotoFP ${byExternal('AI_GotoFP')})`);

  for (const worldPath of args.worlds) {
    const points = freePointsOfWorld(worldPath);
    const r = resolveFreePointSites(sites, points);
    console.log(
      `\n${path.basename(worldPath)} — ${points.length} named ${FREE_POINT_CLASS}\n`
      + `  literal ${r.literal}, non-literal ${r.nonLiteral}\n`
      + `  exact ${r.exact}, prefix ${r.prefix}, infix ${r.infix}, unresolved ${r.unresolved}`
    );
    const tally = new Map();
    for (const name of r.unresolvedNames) tally.set(name, (tally.get(name) || 0) + 1);
    for (const [name, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    unresolved: ${name} ×${n}`);
    }
  }
}

module.exports = { stripComments, extractFreePointSites, resolveFreePointSites, freePointsOfWorld };

if (require.main === module) main();
