/*
 * bench-merge.js — informational micro-benchmark for the category-stable merge
 * (fix-07 §2.1 / §3). NOT wired into CI: prints numbers only, asserts nothing.
 *
 * It parses a generated synthetic project (scripts/generate-perf-fixture.js) via
 * the daedalus-parser workspace package, then times the editing hot path — one
 * file edited, all selected models re-merged — under two strategies:
 *
 *   A) full rebuild        — every merge Object.assigns all 8 categories from
 *                            all inputs (the pre-fix-07 behavior).
 *   B) category-stable      — reuses category objects whose input signature is
 *                            unchanged; only rebuilds dialogs/functions.
 *
 * Strategy B is re-implemented here rather than imported: the real
 * implementation lives in the renderer TS store (projectStore.mergeSemanticModels)
 * and cannot be loaded from plain Node. This bench mirrors that logic exactly
 * (same MERGE_CATEGORY_KEYS, same signature-cache semantics) so the numbers track
 * the shipped behavior; see docs/architecture/render-performance.md.
 *
 * Usage:
 *   node scripts/bench-merge.js [--dir DIR] [--iterations N] [--npc-files K]
 *
 * --dir defaults to perf-fixtures/ (run generate-perf-fixture.js first).
 */

const fs = require('fs');
const path = require('path');

const DaedalusParser = require('daedalus-parser');
const { SemanticModelBuilderVisitor } = require('daedalus-parser/semantic-visitor');

const MERGE_CATEGORY_KEYS = [
  'dialogs', 'functions', 'constants', 'variables',
  'instances', 'items', 'npcs', 'animations'
];

const wrapper = new DaedalusParser();

function parseSource(src) {
  const tree = wrapper.parse(src).tree;
  const visitor = new SemanticModelBuilderVisitor();
  visitor.checkForSyntaxErrors(tree.rootNode, src);
  if (visitor.semanticModel.hasErrors) return visitor.semanticModel;
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);
  return visitor.semanticModel;
}

function emptyModel() {
  const m = {};
  for (const key of MERGE_CATEGORY_KEYS) m[key] = {};
  return m;
}

// Strategy A: rebuild every category from scratch on every merge.
function mergeFull(models) {
  const merged = emptyModel();
  for (const key of MERGE_CATEGORY_KEYS) {
    for (const model of models) {
      if (model[key]) Object.assign(merged[key], model[key]);
    }
  }
  return merged;
}

// Strategy B: signature-cached merge (mirrors projectStore.mergeSemanticModels).
function makeStableMerger() {
  let cache = {};
  let rebuilds = 0;
  let reuses = 0;
  function merge(models) {
    const merged = emptyModel();
    for (const key of MERGE_CATEGORY_KEYS) {
      const inputs = [];
      for (const model of models) {
        if (model[key]) inputs.push(model[key]);
      }
      const prev = cache[key];
      const matches =
        prev &&
        prev.signature.length === inputs.length &&
        prev.signature.every((ref, i) => ref === inputs[i]);
      if (matches) {
        merged[key] = prev.merged;
        reuses++;
      } else {
        for (const category of inputs) Object.assign(merged[key], category);
        cache[key] = { signature: inputs, merged: merged[key] };
        rebuilds++;
      }
    }
    return merged;
  }
  return {
    merge,
    stats: () => ({ rebuilds, reuses }),
    reset: () => { cache = {}; rebuilds = 0; reuses = 0; }
  };
}

// Simulate an Immer edit: new top-level model + fresh functions/dialogs objects
// (new refs, same content), all other category refs preserved.
function editModel(model) {
  const next = {};
  for (const key of MERGE_CATEGORY_KEYS) next[key] = model[key];
  next.functions = Object.assign({}, model.functions);
  next.dialogs = Object.assign({}, model.dialogs);
  return next;
}

function countSymbols(models) {
  let total = 0;
  for (const model of models) {
    for (const key of MERGE_CATEGORY_KEYS) {
      if (model[key]) total += Object.keys(model[key]).length;
    }
  }
  return total;
}

function time(label, fn, iterations) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn(i);
  const end = process.hrtime.bigint();
  const totalMs = Number(end - start) / 1e6;
  return { label, totalMs, perIter: totalMs / iterations };
}

function parseArgs(argv) {
  const opts = { dir: null, iterations: 200, npcFiles: 4 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') opts.dir = argv[++i];
    else if (arg === '--iterations') opts.iterations = parseInt(argv[++i], 10);
    else if (arg === '--npc-files') opts.npcFiles = parseInt(argv[++i], 10);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dir = opts.dir
    ? path.resolve(opts.dir)
    : path.join(__dirname, '..', 'perf-fixtures');

  if (!fs.existsSync(dir)) {
    console.error(`Fixture dir not found: ${dir}`);
    console.error('Run: node scripts/generate-perf-fixture.js [--files N] --out <dir>');
    process.exit(1);
    return;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.d'));
  const globalFiles = files.filter(f => !f.startsWith('DIA_'));
  const dialogFiles = files.filter(f => f.startsWith('DIA_'));

  console.log(`Parsing ${files.length} files from ${dir} ...`);
  const parseStart = process.hrtime.bigint();
  const globalModels = globalFiles.map(f =>
    parseSource(fs.readFileSync(path.join(dir, f), 'utf8'))
  );
  // Select one NPC's worth of dialog files as the "open NPC" working set.
  const selectedFiles = dialogFiles.slice(0, opts.npcFiles);
  const npcModels = selectedFiles.map(f =>
    parseSource(fs.readFileSync(path.join(dir, f), 'utf8'))
  );
  const parseMs = Number(process.hrtime.bigint() - parseStart) / 1e6;

  const workingSet = globalModels.concat(npcModels);
  console.log(
    `Parsed globals (${globalModels.length}) + selected NPC files ` +
    `(${npcModels.length}) in ${parseMs.toFixed(0)} ms`
  );
  console.log(`Working-set symbols across all categories: ${countSymbols(workingSet)}`);
  console.log(`Editing hot path: ${opts.iterations} re-merges (one dialog file edited each time)\n`);

  // Strategy A — full rebuild each merge.
  const editedIndex = globalModels.length; // first NPC file
  const fullResult = time('A) full rebuild', () => {
    const models = workingSet.slice();
    models[editedIndex] = editModel(models[editedIndex]);
    mergeFull(models);
  }, opts.iterations);

  // Strategy B — category-stable. Prime the cache once, then edit each iter.
  const stable = makeStableMerger();
  stable.merge(workingSet);
  const stableResult = time('B) category-stable', () => {
    const models = workingSet.slice();
    models[editedIndex] = editModel(models[editedIndex]);
    stable.merge(models);
  }, opts.iterations);

  const { rebuilds, reuses } = stable.stats();

  const fmt = r => `${r.label.padEnd(20)} ${r.totalMs.toFixed(1)} ms total  ` +
    `${(r.perIter * 1000).toFixed(1)} µs/merge`;
  console.log(fmt(fullResult));
  console.log(fmt(stableResult));
  const speedup = fullResult.perIter / stableResult.perIter;
  console.log(`\nSpeedup (per-merge): ${speedup.toFixed(1)}x`);
  console.log(
    `Category work over ${opts.iterations} edits — rebuilds: ${rebuilds}, ` +
    `reuses: ${reuses} (each edit rebuilds only dialogs+functions; the other ` +
    `6 categories are reused by identity)`
  );
}

main();
