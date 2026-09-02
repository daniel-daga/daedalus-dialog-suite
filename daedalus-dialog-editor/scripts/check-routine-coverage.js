'use strict';

// What does a day of retail's routines actually look like? (level-editor.md
// §16.19, the time-slider slice; §16.22's shape — one script per question,
// then one check per answer.)
//
// Two questions, and the first one gates the second:
//
//  1. **Does the routine index see the routines?** `extractRoutineSites`
//     resolves a `TA_*` wrapper by following its parameters into `TA_MIN`
//     rather than by matching parameter *names*, precisely so that no naming
//     convention has to be assumed — but "no wrapper resolved at all" and "the
//     corpus has no routines" look identical from a count of sites. So this
//     reports the calls written in the source beside the entries that reached
//     the index, and names every `TA_*` call it could not resolve. The spawn
//     index shipped at 71% for a year because nothing reported that ratio
//     (§16.19); this is that report, before the fact rather than after.
//
//  2. **Are gaps and overlaps findings, or are they how the game is built?**
//     §11 names gap/overlap checks among Phase 1c's deliverables and §16.19
//     records them as uncarded because nobody has said what the rule is. §16.22
//     is the precedent for settling that by counting — and for the answer being
//     allowed to kill the check, as the occupancy measurement's did.
//
//   npm run build:main
//   node scripts/check-routine-coverage.js --project "<...>\mdk\Content"
//
// Developer-local: it needs a script corpus and a built `dist/main`. Nothing in
// CI runs it.

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

/**
 * `routineSchedule.ts` is renderer domain and `tsconfig.main.json` does not
 * emit it, so it is transpiled here rather than duplicated. It imports nothing
 * at runtime — the one import is a type — so a bundler is not needed.
 */
function loadSchedule() {
  const source = path.join(__dirname, '..', 'src', 'renderer', 'routines', 'routineSchedule.ts');
  const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'module', js)(module.exports, module);
  return module.exports;
}

/**
 * `TA`-family calls written in a source, counted from the text with comments
 * stripped — retail comments routines out in bulk, and a commented-out entry is
 * not one the index lost. Declarations are subtracted: `func void
 * TA_Stand_WP(...)` matches the same shape as a call to it, and so does
 * `instance TA_Testmodell (Npc_Default)` — retail has two of those.
 */
function countRoutineCalls(source) {
  let code = '';
  let state = 'code'; // code | line | block | string
  for (let i = 0; i < source.length; i += 1) {
    const two = source.substr(i, 2);
    if (state === 'code') {
      if (two === '//') { state = 'line'; i += 1; }
      else if (two === '/*') { state = 'block'; i += 1; }
      else { if (source[i] === '"') state = 'string'; code += source[i]; }
    } else if (state === 'string') {
      if (source[i] === '"') state = 'code';
    } else if (state === 'line') {
      if (source[i] === '\n') { state = 'code'; code += '\n'; }
    } else if (two === '*/') { state = 'code'; i += 1; }
  }
  const calls = (code.match(/\bTA(_\w+)?\s*\(/gi) || []).length;
  const declarations = (code.match(/\b(func\s+\w+|instance|prototype)\s+TA(_\w+)?\s*\(/gi) || []).length;
  return calls - declarations;
}

/** Ascending histogram of a number over routines. */
function histogram(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([n, routines]) => ({ n, routines }));
}

function parseArgs(argv) {
  let project = null;
  let top = 15;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') project = argv[i + 1];
    if (argv[i] === '--top') top = Number(argv[i + 1]);
  }
  if (!project) throw new Error('usage: check-routine-coverage.js --project <script tree> [--top n]');
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

/**
 * Every `TA_*` call the argument index did not resolve, by callee. This is the
 * question-1 readout: a wrapper whose body does not pass its parameters into a
 * known carrier lands here instead of vanishing.
 */
function unresolvedCallees(fileModels, argIndex) {
  const counts = new Map();
  for (const { semanticModel } of fileModels) {
    for (const func of Object.values(semanticModel.functions || {})) {
      for (const call of func.callSites || []) {
        const name = call.functionName;
        if (!/^TA(_|$)/i.test(name)) continue;
        if (argIndex[name.toLowerCase()]) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  // Built output, not source: the extraction is TypeScript in src/main.
  const metadata = require('../dist/main/utils/semanticMetadataUtils.js');
  const { coverageOf } = loadSchedule();

  const files = collectScripts(args.project);
  const fileModels = [];
  let failed = 0;
  let written = 0;

  for (const file of files) {
    try {
      // windows-1252 on disk; only ASCII identifiers matter to the count, and
      // latin1 never throws on a byte utf-8 would reject.
      const source = fs.readFileSync(file, 'latin1');
      written += countRoutineCalls(source);
      const result = metadata.extractFileMetadataFromSource(source, file);
      if (result.semanticModel) fileModels.push({ filePath: file, semanticModel: result.semanticModel });
    } catch {
      failed += 1;
    }
  }

  const argIndex = metadata.buildRoutineParamIndex(fileModels);
  const sites = metadata.extractRoutineSites(fileModels);
  const routinesByNpc = metadata.extractRoutinesByNpc(fileModels);

  console.log(`\n${path.basename(args.project)} — routine coverage\n`);
  console.log(`  ${files.length} .d files, ${fileModels.length} with a complete model, ${failed} failed to parse`);
  console.log(`  ${sites.length} of ${written} TA-family calls reached the index (comments and declarations excluded from both)`);
  console.log(`  ${Object.keys(argIndex).length} routine-carrying functions resolved, ${Object.keys(routinesByNpc).length} NPCs with a daily_routine`);

  const unresolved = unresolvedCallees(fileModels, argIndex);
  if (unresolved.length === 0) {
    console.log('  every TA_* callee resolved');
  } else {
    console.log(`  ${unresolved.length} TA_* callees did NOT resolve:`);
    for (const [name, count] of unresolved.slice(0, args.top)) {
      console.log(`    ${name.padEnd(30)}${count} calls`);
    }
  }

  const routines = [...new Set(sites.map((site) => site.routine))];
  const coverage = routines.map((routine) => coverageOf(sites, routine));
  const withGaps = coverage.filter((entry) => entry.gaps.length > 0);
  const withOverlaps = coverage.filter((entry) => entry.overlaps.length > 0);

  const minutesIn = (windows) =>
    windows.reduce(
      (total, window) =>
        total + (window.endMinute > window.startMinute
          ? window.endMinute - window.startMinute
          : 1440 - window.startMinute + window.endMinute),
      0
    );

  console.log(`\n  ${routines.length} routines have at least one entry`);
  console.log(`  ${withGaps.length} leave part of the day uncovered, ${withOverlaps.length} cover part of it twice\n`);

  console.log('  gap windows per routine');
  for (const bin of histogram(coverage.map((entry) => entry.gaps.length))) {
    console.log(`    ${String(bin.n).padEnd(28)}${bin.routines} routines`);
  }
  console.log('  overlap windows per routine');
  for (const bin of histogram(coverage.map((entry) => entry.overlaps.length))) {
    console.log(`    ${String(bin.n).padEnd(28)}${bin.routines} routines`);
  }

  const worst = withGaps
    .map((entry) => ({ routine: entry.routine, minutes: minutesIn(entry.gaps) }))
    .sort((a, b) => b.minutes - a.minutes);
  if (args.top > 0 && worst.length) {
    console.log(`\n  most uncovered ${Math.min(args.top, worst.length)}`);
    for (const entry of worst.slice(0, args.top)) {
      console.log(`    ${entry.routine.padEnd(34)}${entry.minutes} minutes`);
    }
  }
}

module.exports = { countRoutineCalls, unresolvedCallees };

if (require.main === module) main();
