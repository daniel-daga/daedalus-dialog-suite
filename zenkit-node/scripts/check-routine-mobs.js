'use strict';

// How far is a routine state's mob from the waypoint it runs at? (npc-editor.md
// §6, slice 7; #318.)
//
// The state-needs check would warn when `TA_Sleep` has no bed near its
// waypoint. Whether that is a check at all depends on retail: if shipped
// routines routinely run a mob state with no such mob nearby, the warning
// would flag Khorinis, and the measurement kills it (level-editor.md §16.22).
//
// The table is read from the scripts, not written by hand. `TA.d` maps each
// `TA_<x>` to its `ZS_<y>` through `TA_Min`; the file defining `ZS_<y>` names
// the scheme it sits down at with `AI_UseMob(self, "<SCHEME>", 1)`. A mob's
// scheme is its visual name up to the first `_` (`BEDHIGH_1_OC.ASC` →
// `BEDHIGH`), which is how the engine matches one.
//
//   node scripts/check-routine-mobs.js --scripts "<mdk>\Scripts\Content" \
//     --world NEWWORLD.ZEN --world OLDWORLD.ZEN --world ADDONWORLD.ZEN
//
// Developer-local: it needs a real installation. Nothing in CI runs it.

const fs = require('node:fs');
const path = require('node:path');

const TA_LINE = /func\s+void\s+(TA_\w+)\s*\([^)]*\)\s*\{\s*TA_Min\s*\([^;]*?,\s*(ZS_\w+)\s*,\s*\w+\s*\)/gi;
const USE_MOB = /AI_UseMob\s*\(\s*self\s*,\s*"([^"]+)"\s*,\s*1\s*\)/gi;
const ROUTINE_ENTRY = /\b(TA_\w+)\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*"([^"]*)"\s*\)/gi;

/**
 * `TA_<x>` (uppercased) → the schemes its state uses, for every TA whose state
 * uses one. `zsSources` is the text of each file that may define a `ZS_*`.
 */
function stateSchemes(taSource, zsSources) {
  const definedIn = new Map(); // ZS name, uppercased → file text
  for (const text of zsSources) {
    for (const m of text.matchAll(/func\s+\w+\s+(ZS_\w+)\s*\(/gi)) definedIn.set(m[1].toUpperCase(), text);
  }
  const table = new Map();
  for (const m of taSource.matchAll(TA_LINE)) {
    const text = definedIn.get(m[2].toUpperCase());
    if (text === undefined) continue;
    const schemes = [...new Set([...text.matchAll(USE_MOB)].map((u) => u[1].toUpperCase()))];
    if (schemes.length > 0) table.set(m[1].toUpperCase(), { state: m[2], schemes });
  }
  return table;
}

/** Every `TA_<x>(h, m, h, m, "WP")` call in one script file. */
function routineEntries(text) {
  return [...text.matchAll(ROUTINE_ENTRY)].map((m) => ({ ta: m[1].toUpperCase(), waypoint: m[2].toUpperCase() }));
}

/** The engine's scheme name for a mob visual: the name up to its first `_`. */
function schemeOfVisual(visual) {
  const base = visual.toUpperCase().replace(/\.[A-Z0-9]+$/, '');
  return base.split('_')[0];
}

/**
 * The nearest mob of any of `schemes` to `at`, in world units, or null when the
 * world has none.
 */
function nearestMob(at, schemes, mobs) {
  let best = null;
  for (const mob of mobs) {
    if (!schemes.includes(mob.scheme)) continue;
    const d = Math.hypot(mob.position[0] - at[0], mob.position[1] - at[1], mob.position[2] - at[2]);
    if (best === null || d < best) best = d;
  }
  return best;
}

function readScripts(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) readScripts(at, out);
    else if (/\.d$/i.test(entry.name)) out.push(fs.readFileSync(at, 'latin1'));
  }
  return out;
}

function worldIndex(zenkit, file) {
  const dump = zenkit.normalizeWorld(zenkit.loadWorld(file, 'g2'));
  const points = new Map(dump.waynet.waypoints.map((w) => [w.name.toUpperCase(), w.position]));
  const mobs = [];
  const walk = (vob) => {
    if (/^oCMob./i.test(vob.class) && vob.visual) mobs.push({ scheme: schemeOfVisual(vob.visual), position: vob.position });
    (vob.children ?? []).forEach(walk);
  };
  dump.vobs.forEach(walk);
  return { name: path.basename(file), points, mobs };
}

function parseArgs(argv) {
  let scripts = null;
  const worlds = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scripts') scripts = argv[i + 1];
    if (argv[i] === '--world') worlds.push(argv[i + 1]);
  }
  if (!scripts || worlds.length === 0) {
    throw new Error('usage: check-routine-mobs.js --scripts <Scripts/Content> --world <a.zen> [--world <b.zen> ...]');
  }
  return { scripts, worlds };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const zenkit = require('..');

  const sources = readScripts(args.scripts);
  const taFile = path.join(args.scripts, 'AI', 'Human', 'TA.d');
  const table = stateSchemes(fs.readFileSync(taFile, 'latin1'), sources);
  const worlds = args.worlds.map((w) => worldIndex(zenkit, w));

  const perTa = new Map();
  let notFound = 0;
  let ambiguous = 0;
  for (const text of sources) {
    for (const entry of routineEntries(text)) {
      const need = table.get(entry.ta);
      if (need === undefined) continue;
      const homes = worlds.filter((w) => w.points.has(entry.waypoint));
      if (homes.length === 0) { notFound += 1; continue; }
      // A name in several worlds is read generously — the nearest mob in any
      // of them — so a miss that survives is not an artefact of picking.
      if (homes.length > 1) ambiguous += 1;
      let world = homes[0];
      let d = null;
      for (const home of homes) {
        const here = nearestMob(home.points.get(entry.waypoint), need.schemes, home.mobs);
        if (here !== null && (d === null || here < d)) { d = here; world = home; }
      }
      if (!perTa.has(entry.ta)) perTa.set(entry.ta, { schemes: need.schemes, distances: [], misses: [] });
      const row = perTa.get(entry.ta);
      row.distances.push(d === null ? Infinity : d);
      row.misses.push({ waypoint: entry.waypoint, world: world.name, d });
    }
  }

  console.log('\nstate → scheme, from the scripts');
  for (const [ta, need] of [...table].sort()) console.log(`  ${ta.padEnd(28)}${need.state.padEnd(24)}${need.schemes.join(', ')}`);

  const buckets = [200, 500, 1000, 2000, 5000];
  console.log(`\nnearest mob of the state's scheme to its waypoint (cm), per routine entry`);
  console.log(`  ${'TA'.padEnd(26)}${'n'.padStart(5)}${'p50'.padStart(8)}${'p90'.padStart(8)}${'max'.padStart(9)}` +
    buckets.map((b) => `>${b}`.padStart(7)).join('') + '  none');
  const all = [];
  for (const [ta, row] of [...perTa].sort()) {
    const sorted = [...row.distances].sort((a, b) => a - b);
    all.push(...sorted);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const fmt = (v) => (v === Infinity ? '—' : String(Math.round(v)));
    console.log(`  ${ta.padEnd(26)}${String(sorted.length).padStart(5)}${fmt(q(0.5)).padStart(8)}${fmt(q(0.9)).padStart(8)}` +
      `${fmt(sorted[sorted.length - 1]).padStart(9)}` +
      buckets.map((b) => String(sorted.filter((d) => d > b && d !== Infinity).length).padStart(7)).join('') +
      `  ${sorted.filter((d) => d === Infinity).length}`);
  }
  console.log(`\n  entries measured ${all.length}; waypoint in no world ${notFound}; waypoint in more than one ${ambiguous}`);
  for (const b of buckets) console.log(`  further than ${String(b).padStart(5)} cm (or none): ${all.filter((d) => d > b).length}`);

  if (process.argv.includes('--list')) {
    for (const [ta, row] of perTa) {
      for (const m of row.misses.filter((x) => x.d === null || x.d > 500)) {
        console.log(`    ${ta} ${m.waypoint} (${m.world}): ${m.d === null ? 'none' : Math.round(m.d)}`);
      }
    }
  }
}

module.exports = { stateSchemes, routineEntries, schemeOfVisual, nearestMob };

if (require.main === module) main();
