#!/usr/bin/env node
'use strict';

// #541: what a model build costs, per stage, against a script tree. Run the
// same command before and after a change and compare the same file set:
//
//   node scripts/benchmark-model.js --root test/fixtures/corpus --repeat 5
//   node scripts/benchmark-model.js --root ../mdk/Content/Story/Dialoge
//
// Wall-clock numbers are this machine's; the ratios and the model/source size
// are what the issue is about.

const fs = require('fs');
const path = require('path');
const DaedalusParser = require('../src/core/parser');
const {
  SemanticModelBuilderVisitor,
  SemanticCodeGenerator,
  deserializeSemanticModel
} = require('../dist/semantic/semantic-visitor-index');

function parseArgs(argv) {
  const args = { repeat: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = argv[++i];
    else if (argv[i] === '--repeat') args.repeat = Number(argv[++i]);
    else if (argv[i] === '--max-files') args.maxFiles = Number(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function collectScripts(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.d')) files.push(full);
    }
  }
  return files.sort();
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ms(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  return { ms: Number(process.hrtime.bigint() - start) / 1e6, result };
}

/** One sample of every stage for one file. */
function sample(parser, generator, filePath, repeat) {
  const source = parser.parseFile(filePath);
  if (source.hasErrors) return { filePath, status: 'syntax_error' };

  const timings = { parse: [], pass1: [], pass2: [], stringify: [], parseJson: [], hydrate: [], generate: [] };
  let model;
  let json;

  for (let i = 0; i < repeat; i += 1) {
    const parsed = ms(() => parser.parseFile(filePath));
    timings.parse.push(parsed.ms);

    const visitor = new SemanticModelBuilderVisitor();
    const root = parsed.result.rootNode;
    timings.pass1.push(ms(() => visitor.pass1_createObjects(root)).ms);
    timings.pass2.push(ms(() => visitor.pass2_analyzeAndLink(root)).ms);

    model = visitor.semanticModel;
    const encoded = ms(() => JSON.stringify(model));
    timings.stringify.push(encoded.ms);
    json = encoded.result;

    timings.parseJson.push(ms(() => JSON.parse(json)).ms);
    const plain = JSON.parse(json);
    timings.hydrate.push(ms(() => deserializeSemanticModel(plain)).ms);
    timings.generate.push(ms(() => generator.generateSemanticModel(model)).ms);
  }

  const withoutCallSites = JSON.stringify({
    ...model,
    functions: Object.fromEntries(Object.entries(model.functions).map(([name, func]) => {
      const copy = { ...func };
      delete copy.callSites;
      return [name, copy];
    }))
  });

  return {
    filePath,
    status: 'ok',
    sourceBytes: fs.statSync(filePath).size,
    modelBytes: Buffer.byteLength(json),
    withoutCallSitesBytes: Buffer.byteLength(withoutCallSites),
    median: Object.fromEntries(Object.entries(timings).map(([stage, values]) => [stage, median(values)]))
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root || args.help) {
    console.error('usage: node scripts/benchmark-model.js --root <script tree> [--repeat n] [--max-files n]');
    process.exit(args.help ? 0 : 1);
  }
  if (!Number.isInteger(args.repeat) || args.repeat < 1) throw new Error('--repeat must be a positive integer');

  const parser = new DaedalusParser();
  const generator = new SemanticCodeGenerator();
  let files = collectScripts(args.root);
  if (args.maxFiles) files = files.slice(0, args.maxFiles);

  const rows = files.map((file) => sample(parser, generator, file, args.repeat));
  const ok = rows.filter((row) => row.status === 'ok');

  console.log(`corpus ${path.resolve(args.root)} — ${files.length} files, ${ok.length} measured, ` +
    `${files.length - ok.length} with syntax errors; median of ${args.repeat} warm runs`);
  console.log(`node ${process.version} ${process.platform}`);
  const header = ['file', 'source B', 'model B', 'no sites B', 'parse ms', 'pass1 ms', 'pass2 ms', 'json ms', 'hydrate ms', 'gen ms'];
  console.log(header.join('\t'));
  for (const row of [...ok].sort((a, b) => b.median.pass2 - a.median.pass2)) {
    console.log([
      path.relative(args.root, row.filePath),
      row.sourceBytes,
      row.modelBytes,
      row.withoutCallSitesBytes,
      row.median.parse.toFixed(1),
      row.median.pass1.toFixed(1),
      row.median.pass2.toFixed(1),
      row.median.stringify.toFixed(1),
      row.median.hydrate.toFixed(1),
      row.median.generate.toFixed(1)
    ].join('\t'));
  }

  const total = (key) => ok.reduce((sum, row) => sum + row.median[key], 0);
  const sourceBytes = ok.reduce((sum, row) => sum + row.sourceBytes, 0);
  const modelBytes = ok.reduce((sum, row) => sum + row.modelBytes, 0);
  const withoutSites = ok.reduce((sum, row) => sum + row.withoutCallSitesBytes, 0);
  const parse = total('parse');
  const pass1 = total('pass1');
  const pass2 = total('pass2');
  const modelBuild = pass1 + pass2;

  console.log('');
  console.log(`total: parse ${parse.toFixed(1)} ms, pass1 ${pass1.toFixed(1)} ms, pass2 ${pass2.toFixed(1)} ms, ` +
    `build ${modelBuild.toFixed(1)} ms (${(modelBuild / parse).toFixed(1)}x parse)`);
  console.log(`total: json ${total('stringify').toFixed(1)} ms, hydrate ${total('hydrate').toFixed(1)} ms, ` +
    `generate ${total('generate').toFixed(1)} ms`);
  console.log(`size: source ${sourceBytes} B, model ${modelBytes} B (${(modelBytes / sourceBytes).toFixed(1)}x), ` +
    `without callSites ${withoutSites} B (${(100 * (1 - withoutSites / modelBytes)).toFixed(0)}% smaller)`);
  console.log(`peak rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
}

main();
