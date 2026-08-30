'use strict';

// Do quest-state routine variants recur across NPCs, or is every one bespoke?
// (level-editor.md §16.19 slice 11 — the measurement that gates slice 13's
// control shape; `check-routine-coverage.js` is its sibling and its shape.)
//
// Three questions, and the first one decides a UI:
//
//  1. **Is a global State dropdown the right control?** The picker offers the
//     distinct state names of the whole project. That is right if names recur —
//     a dozen shared ones like TOT or KAPITEL3 — and wrong if NPCs mostly carry
//     bespoke suffixes, because then the list is hundreds long and unusable,
//     and the honest control is a filter field or a per-NPC affordance. So this
//     reports the distinct names and how many NPCs each reaches. **The plan
//     says not to trust the select until this has run.**
//
//  2. **Does the RTN_<state>_<id> rule actually find what the scripts
//     trigger?** Variants are enumerated by the engine's name rule, never from
//     the exchange sites — an exchange reaching a state through a variable
//     would be missed. That is deliberate, but it can drift both ways, and both
//     are worth seeing: a state some `Npc_ExchangeRoutine` names with no
//     variant behind it (the rule missed it, or the routine has no readable
//     entries), and a variant no exchange anywhere triggers (dead, or reached
//     dynamically).
//
//  3. **How much of the cast can the lens move at all?** The NPCs with any
//     variant, against the NPCs with a declared routine — the ceiling on the
//     reach readout the picker draws.
//
//   npm run build:main
//   node scripts/check-routine-states.js --project "<...>\mdk\Content"
//
// Developer-local: it needs a script corpus and a built `dist/main`. Nothing in
// CI runs it.

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  let project = null;
  let top = 20;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') project = argv[i + 1];
    if (argv[i] === '--top') top = Number(argv[i + 1]);
  }
  if (!project) throw new Error('usage: check-routine-states.js --project <script tree> [--top n]');
  return { project, top };
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
  return files.sort();
}

/** Ascending histogram of a number over whatever was counted. */
function histogram(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  // Built output, not source: the extraction is TypeScript in src/main.
  const metadata = require('../dist/main/utils/semanticMetadataUtils.js');

  const files = collectScripts(args.project);
  const fileModels = [];
  let failed = 0;

  for (const file of files) {
    try {
      // windows-1252 on disk; latin1 never throws on a byte utf-8 would reject.
      const source = fs.readFileSync(file, 'latin1');
      const result = metadata.extractFileMetadataFromSource(source, file);
      if (result.semanticModel) fileModels.push({ filePath: file, semanticModel: result.semanticModel });
    } catch {
      failed += 1;
    }
  }

  const routineSites = metadata.extractRoutineSites(fileModels);
  const routinesByNpc = metadata.extractRoutinesByNpc(fileModels);
  const statesByNpc = metadata.extractRoutineStatesByNpc(fileModels, routineSites);
  const exchanges = metadata.extractExchangeSites(fileModels);

  console.log(`\n${path.basename(args.project)} — routine states\n`);
  console.log(`  ${files.length} .d files, ${fileModels.length} with a complete model, ${failed} failed to parse`);

  // Question 3 first: it is the denominator everything else reads against.
  const withStates = Object.keys(statesByNpc).length;
  const withRoutine = Object.keys(routinesByNpc).length;
  console.log(`  ${withStates} of ${withRoutine} NPCs with a declared routine have at least one variant`);

  // Question 1 — the one that decides the control.
  const npcsPerState = new Map();
  for (const [npc, entry] of Object.entries(statesByNpc)) {
    for (const state of Object.keys(entry.states)) {
      if (!npcsPerState.has(state)) npcsPerState.set(state, []);
      npcsPerState.get(state).push(npc);
    }
  }
  const ranked = [...npcsPerState.entries()].sort((a, b) => b[1].length - a[1].length);

  console.log(`\n  ${ranked.length} distinct state names — this is the dropdown's length`);
  console.log('  NPCs per state name');
  for (const [reach, states] of histogram(ranked.map(([, npcs]) => npcs.length))) {
    console.log(`    reaches ${String(reach).padEnd(6)}${states} state names`);
  }
  if (ranked.length) {
    console.log(`\n  most shared ${Math.min(args.top, ranked.length)}`);
    for (const [state, npcs] of ranked.slice(0, args.top)) {
      console.log(`    ${state.padEnd(34)}${npcs.length} NPCs`);
    }
  }

  // Question 2 — the drift, both directions.
  const triggered = new Set(exchanges.map((site) => site.state));
  const written = new Set(npcsPerState.keys());
  const triggeredNotWritten = [...triggered].filter((state) => !written.has(state)).sort();
  const writtenNotTriggered = [...written].filter((state) => !triggered.has(state)).sort();

  console.log(`\n  ${exchanges.length} exchange calls with a literal state, ${triggered.size} distinct states triggered`);
  console.log(`  ${triggeredNotWritten.length} triggered with no variant found, ${writtenNotTriggered.length} variants nothing triggers`);
  for (const state of triggeredNotWritten.slice(0, args.top)) {
    console.log(`    triggered, not written   ${state}`);
  }
  for (const state of writtenNotTriggered.slice(0, args.top)) {
    console.log(`    written, not triggered   ${state}`);
  }
}

module.exports = { histogram };

if (require.main === module) main();
