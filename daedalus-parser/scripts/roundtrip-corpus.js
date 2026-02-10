#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const DaedalusParser = require('../src/core/parser');
const { SemanticModelBuilderVisitor } = require('../dist/semantic/semantic-visitor-index');
const { SemanticCodeGenerator } = require('../dist/codegen/generator');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--root') {
      args.root = argv[i + 1];
      i += 1;
    } else if (token === '--report-prefix') {
      args.reportPrefix = argv[i + 1];
      i += 1;
    } else if (token === '--max-files') {
      args.maxFiles = Number(argv[i + 1]);
      i += 1;
    } else if (token === '--report-dir') {
      args.reportDir = argv[i + 1];
      i += 1;
    } else if (token === '--strict') {
      args.strict = true;
    } else if (token === '--no-strict') {
      args.strict = false;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  const text = [
    'Usage: node scripts/roundtrip-corpus.js [options]',
    '',
    'Options:',
    '  --root <path>             Corpus root to scan recursively for .d files',
    '  --report-prefix <prefix>  Prefix for report files (default: dialog-roundtrip-corpus)',
    '  --report-dir <path>       Directory for generated reports (default: <repo>/reports)',
    '  --max-files <n>           Stop after processing n files',
    '  --strict                  Exit 1 on structural drift (default)',
    '  --no-strict               Always exit 0',
    '  --help, -h                Show this help',
    '',
    'Examples:',
    '  npm run test:roundtrip-corpus -- --root "C:\\\\mods\\\\Story\\\\Dialoge"',
    '  npm run test:roundtrip-corpus -- --max-files 50 --no-strict'
  ];
  console.log(text.join('\n'));
}

function collectDialogFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.d')) {
        files.push(fullPath);
      }
    }
  }

  files.sort();
  return files;
}

function extractModelSummary(model) {
  const dialogs = Object.keys(model.dialogs).sort();
  const functions = Object.keys(model.functions).sort();
  const functionStats = {};
  for (const fnName of functions) {
    const fn = model.functions[fnName];
    functionStats[fnName] = {
      actions: fn.actions.length,
      conditions: fn.conditions.length
    };
  }

  const missingChoiceTargets = [];
  for (const fnName of functions) {
    const fn = model.functions[fnName];
    for (const action of fn.actions) {
      if (action && action.type === 'Choice' && action.targetFunction && !model.functions[action.targetFunction]) {
        missingChoiceTargets.push({
          function: fnName,
          target: action.targetFunction
        });
      }
    }
  }

  return {
    dialogs,
    functions,
    functionStats,
    missingChoiceTargets
  };
}

function setDiff(lhs, rhs) {
  const rhsSet = new Set(rhs);
  return lhs.filter((item) => !rhsSet.has(item));
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  const out = {};
  const keys = Object.keys(value)
    .filter((k) => !['node', 'sourceNode', 'rawNode'].includes(k))
    .sort();
  for (const key of keys) {
    const v = value[key];
    if (v === undefined || typeof v === 'function') continue;
    out[key] = canonicalize(v);
  }
  return out;
}

function normalizeCodeLikeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeForSemanticSignature(item) {
  if (!item || typeof item !== 'object') return item;
  const copy = { ...item };

  if (copy.type === 'Action' && typeof copy.action === 'string') {
    copy.action = normalizeCodeLikeWhitespace(copy.action);
  }
  if (copy.type === 'Condition' && typeof copy.condition === 'string') {
    copy.condition = normalizeCodeLikeWhitespace(copy.condition);
  }

  return copy;
}

function toSignature(item) {
  return JSON.stringify(canonicalize(normalizeForSemanticSignature(item)));
}

function multisetFrom(items) {
  const map = new Map();
  for (const item of items) {
    const signature = toSignature(item);
    map.set(signature, (map.get(signature) || 0) + 1);
  }
  return map;
}

function diffMultiset(beforeItems, afterItems) {
  const before = multisetFrom(beforeItems);
  const after = multisetFrom(afterItems);
  const allKeys = new Set([...before.keys(), ...after.keys()]);
  const beforeOnly = [];
  const afterOnly = [];

  for (const key of allKeys) {
    const beforeCount = before.get(key) || 0;
    const afterCount = after.get(key) || 0;
    if (beforeCount > afterCount) {
      beforeOnly.push({ signature: key, count: beforeCount - afterCount });
    } else if (afterCount > beforeCount) {
      afterOnly.push({ signature: key, count: afterCount - beforeCount });
    }
  }

  return { beforeOnly, afterOnly };
}

function parseFileWithFallback(filePath, parser) {
  try {
    return parser.parseFile(filePath, { detectEncoding: true });
  } catch (error) {
    const buffer = fs.readFileSync(filePath);
    const fallbackEncodings = ['utf8', 'windows-1252', 'latin1'];

    for (const encoding of fallbackEncodings) {
      try {
        const decoded = iconv.decode(buffer, encoding);
        const parsed = parser.parse(decoded);
        parsed.filePath = filePath;
        parsed.encoding = encoding;
        parsed.encodingConfidence = 0;
        parsed.fallbackEncoding = true;
        return parsed;
      } catch (_decodeError) {
        // Try next encoding.
      }
    }

    throw error;
  }
}

function analyzeFile(filePath, parser, generator) {
  const source = parseFileWithFallback(filePath, parser);

  if (source.hasErrors) {
    return {
      file: filePath,
      status: 'source_syntax_error',
      sourceErrors: source.errors || [],
      fallbackEncodingUsed: !!source.fallbackEncoding
    };
  }

  const sourceVisitor = new SemanticModelBuilderVisitor();
  sourceVisitor.pass1_createObjects(source.rootNode);
  sourceVisitor.pass2_analyzeAndLink(source.rootNode);

  const generatedText = generator.generateSemanticModel(sourceVisitor.semanticModel);
  const generated = parser.parse(generatedText);

  if (generated.hasErrors) {
    return {
      file: filePath,
      status: 'generated_syntax_error',
      generatedErrors: generated.errors || [],
      fallbackEncodingUsed: !!source.fallbackEncoding
    };
  }

  const generatedVisitor = new SemanticModelBuilderVisitor();
  generatedVisitor.pass1_createObjects(generated.rootNode);
  generatedVisitor.pass2_analyzeAndLink(generated.rootNode);

  // Idempotence check: save output should stabilize after the first generation.
  const generatedTextSecond = generator.generateSemanticModel(generatedVisitor.semanticModel);
  const byteIdempotenceDrift = generatedText !== generatedTextSecond;

  const generatedSecond = parser.parse(generatedTextSecond);
  if (generatedSecond.hasErrors) {
    return {
      file: filePath,
      status: 'generated_syntax_error',
      generatedErrors: generatedSecond.errors || [],
      fallbackEncodingUsed: !!source.fallbackEncoding
    };
  }

  const generatedSecondVisitor = new SemanticModelBuilderVisitor();
  generatedSecondVisitor.pass1_createObjects(generatedSecond.rootNode);
  generatedSecondVisitor.pass2_analyzeAndLink(generatedSecond.rootNode);

  const sourceSummary = extractModelSummary(sourceVisitor.semanticModel);
  const generatedSummary = extractModelSummary(generatedVisitor.semanticModel);
  const generatedSecondSummary = extractModelSummary(generatedSecondVisitor.semanticModel);

  const drift = {
    missingDialogs: setDiff(sourceSummary.dialogs, generatedSummary.dialogs),
    extraDialogs: setDiff(generatedSummary.dialogs, sourceSummary.dialogs),
    missingFunctions: setDiff(sourceSummary.functions, generatedSummary.functions),
    extraFunctions: setDiff(generatedSummary.functions, sourceSummary.functions),
    functionCountDrift: [],
    functionCountDriftSecondPass: [],
    functionActionMultisetDrift: [],
    functionConditionMultisetDrift: [],
    functionActionMultisetDriftSecondPass: [],
    functionConditionMultisetDriftSecondPass: [],
    missingChoiceTargetsBefore: sourceSummary.missingChoiceTargets,
    missingChoiceTargetsAfter: generatedSummary.missingChoiceTargets,
    missingChoiceTargetsAfterSecondPass: generatedSecondSummary.missingChoiceTargets,
    choiceTargetIncrease: generatedSummary.missingChoiceTargets.length > sourceSummary.missingChoiceTargets.length,
    byteIdempotenceDrift,
    secondPassMissingDialogs: setDiff(generatedSummary.dialogs, generatedSecondSummary.dialogs),
    secondPassExtraDialogs: setDiff(generatedSecondSummary.dialogs, generatedSummary.dialogs),
    secondPassMissingFunctions: setDiff(generatedSummary.functions, generatedSecondSummary.functions),
    secondPassExtraFunctions: setDiff(generatedSecondSummary.functions, generatedSummary.functions)
  };

  const commonFunctions = sourceSummary.functions.filter((name) => generatedSummary.functions.includes(name));
  for (const fnName of commonFunctions) {
    const before = sourceSummary.functionStats[fnName];
    const after = generatedSummary.functionStats[fnName];
    if (before.actions !== after.actions || before.conditions !== after.conditions) {
      drift.functionCountDrift.push({
        function: fnName,
        before,
        after
      });
    }

    const sourceFn = sourceVisitor.semanticModel.functions[fnName];
    const generatedFn = generatedVisitor.semanticModel.functions[fnName];
    const actionMultisetDiff = diffMultiset(sourceFn.actions, generatedFn.actions);
    const conditionMultisetDiff = diffMultiset(sourceFn.conditions, generatedFn.conditions);
    if (actionMultisetDiff.beforeOnly.length > 0 || actionMultisetDiff.afterOnly.length > 0) {
      drift.functionActionMultisetDrift.push({
        function: fnName,
        ...actionMultisetDiff
      });
    }
    if (conditionMultisetDiff.beforeOnly.length > 0 || conditionMultisetDiff.afterOnly.length > 0) {
      drift.functionConditionMultisetDrift.push({
        function: fnName,
        ...conditionMultisetDiff
      });
    }
  }

  const commonFunctionsSecondPass = generatedSummary.functions.filter((name) => generatedSecondSummary.functions.includes(name));
  for (const fnName of commonFunctionsSecondPass) {
    const before = generatedSummary.functionStats[fnName];
    const after = generatedSecondSummary.functionStats[fnName];
    if (before.actions !== after.actions || before.conditions !== after.conditions) {
      drift.functionCountDriftSecondPass.push({
        function: fnName,
        before,
        after
      });
    }

    const generatedFn = generatedVisitor.semanticModel.functions[fnName];
    const generatedSecondFn = generatedSecondVisitor.semanticModel.functions[fnName];
    const actionMultisetDiff = diffMultiset(generatedFn.actions, generatedSecondFn.actions);
    const conditionMultisetDiff = diffMultiset(generatedFn.conditions, generatedSecondFn.conditions);
    if (actionMultisetDiff.beforeOnly.length > 0 || actionMultisetDiff.afterOnly.length > 0) {
      drift.functionActionMultisetDriftSecondPass.push({
        function: fnName,
        ...actionMultisetDiff
      });
    }
    if (conditionMultisetDiff.beforeOnly.length > 0 || conditionMultisetDiff.afterOnly.length > 0) {
      drift.functionConditionMultisetDriftSecondPass.push({
        function: fnName,
        ...conditionMultisetDiff
      });
    }
  }

  const semanticIdempotenceDrift = drift.secondPassMissingDialogs.length > 0 ||
    drift.secondPassExtraDialogs.length > 0 ||
    drift.secondPassMissingFunctions.length > 0 ||
    drift.secondPassExtraFunctions.length > 0 ||
    drift.functionCountDriftSecondPass.length > 0 ||
    drift.functionActionMultisetDriftSecondPass.length > 0 ||
    drift.functionConditionMultisetDriftSecondPass.length > 0 ||
    drift.missingChoiceTargetsAfterSecondPass.length !== drift.missingChoiceTargetsAfter.length;

  drift.semanticIdempotenceDrift = semanticIdempotenceDrift;

  const hasDrift = drift.missingDialogs.length > 0 ||
    drift.extraDialogs.length > 0 ||
    drift.missingFunctions.length > 0 ||
    drift.extraFunctions.length > 0 ||
    drift.functionCountDrift.length > 0 ||
    drift.functionActionMultisetDrift.length > 0 ||
    drift.functionConditionMultisetDrift.length > 0 ||
    drift.semanticIdempotenceDrift ||
    drift.choiceTargetIncrease ||
    false;

  return {
    file: filePath,
    status: hasDrift ? 'drift' : 'ok',
    drift,
    fallbackEncodingUsed: !!source.fallbackEncoding
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeReports(reportDir, reportPrefix, summary, details) {
  ensureDir(reportDir);
  const summaryPath = path.join(reportDir, `${reportPrefix}-summary.json`);
  const markdownPath = path.join(reportDir, `${reportPrefix}-summary.md`);
  const detailsPath = path.join(reportDir, `${reportPrefix}-details.json`);
  const byteIdempotencePath = path.join(reportDir, `${reportPrefix}-byte-idempotence.json`);

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(detailsPath, `${JSON.stringify(details, null, 2)}\n`, 'utf8');
  const byteIdempotenceOnly = details.filter((d) => d.drift && d.drift.byteIdempotenceDrift);
  fs.writeFileSync(byteIdempotencePath, `${JSON.stringify(byteIdempotenceOnly, null, 2)}\n`, 'utf8');

  const mdLines = [
    `# ${reportPrefix} Summary`,
    '',
    `- Root: \`${summary.root}\``,
    `- Scanned: **${summary.scanned}**`,
    `- OK: **${summary.okFiles}**`,
    `- Drift: **${summary.driftFiles}**`,
    `- Source syntax errors: **${summary.sourceSyntaxErrors}**`,
    `- Generated syntax errors: **${summary.generatedSyntaxErrors}**`,
    `- Fallback-decoded files: **${summary.fallbackDecodedFiles}**`,
    `- Choice target issues before/after: **${summary.choiceTargetIssuesBefore} -> ${summary.choiceTargetIssuesAfter}**`,
    `- Choice target increases: **${summary.choiceTargetIncreases}**`,
    `- Action multiset drift files: **${summary.actionMultisetDriftFiles}**`,
    `- Condition multiset drift files: **${summary.conditionMultisetDriftFiles}**`,
    `- Semantic idempotence drift files: **${summary.semanticIdempotenceDriftFiles}**`,
    `- Byte idempotence drift files (non-failing): **${summary.byteIdempotenceDriftFiles}**`,
    `- Generated at: ${summary.generatedAt}`
  ];

  fs.writeFileSync(markdownPath, `${mdLines.join('\n')}\n`, 'utf8');

  return { summaryPath, markdownPath, detailsPath, byteIdempotencePath };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const strict = args.strict !== false;
  const reportPrefix = args.reportPrefix || 'dialog-roundtrip-corpus';
  const repoRoot = path.resolve(__dirname, '..', '..');
  const root = path.resolve(args.root || path.join(repoRoot, 'mdk', 'Content', 'Story', 'Dialoge'));
  const reportDir = path.resolve(args.reportDir || path.join(repoRoot, 'reports'));

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`Corpus root does not exist or is not a directory: ${root}`);
    process.exit(2);
  }

  const allFiles = collectDialogFiles(root);
  const files = Number.isFinite(args.maxFiles) && args.maxFiles > 0
    ? allFiles.slice(0, args.maxFiles)
    : allFiles;

  const parser = DaedalusParser.create();
  const generator = new SemanticCodeGenerator({
    includeComments: true,
    sectionHeaders: true,
    preserveSourceStyle: true
  });

  const details = [];
  for (const file of files) {
    details.push(analyzeFile(file, parser, generator));
  }

  const summary = {
    root,
    scanned: details.length,
    generatedAt: new Date().toISOString(),
    okFiles: details.filter((d) => d.status === 'ok').length,
    driftFiles: details.filter((d) => d.status === 'drift').length,
    sourceSyntaxErrors: details.filter((d) => d.status === 'source_syntax_error').length,
    generatedSyntaxErrors: details.filter((d) => d.status === 'generated_syntax_error').length,
    fallbackDecodedFiles: details.filter((d) => d.fallbackEncodingUsed).length,
    actionMultisetDriftFiles: details.filter((d) => d.drift && d.drift.functionActionMultisetDrift.length > 0).length,
    conditionMultisetDriftFiles: details.filter((d) => d.drift && d.drift.functionConditionMultisetDrift.length > 0).length,
    semanticIdempotenceDriftFiles: details.filter((d) => d.drift && d.drift.semanticIdempotenceDrift).length,
    byteIdempotenceDriftFiles: details.filter((d) => d.drift && d.drift.byteIdempotenceDrift).length,
    choiceTargetIssuesBefore: details.reduce((sum, d) => sum + ((d.drift && d.drift.missingChoiceTargetsBefore.length) || 0), 0),
    choiceTargetIssuesAfter: details.reduce((sum, d) => sum + ((d.drift && d.drift.missingChoiceTargetsAfter.length) || 0), 0),
    choiceTargetIncreases: details.filter((d) => d.drift && d.drift.choiceTargetIncrease).length
  };

  const reportPaths = writeReports(reportDir, reportPrefix, summary, details);

  console.log(`Roundtrip corpus scan finished.`);
  console.log(`Root: ${root}`);
  console.log(`Scanned: ${summary.scanned}`);
  console.log(`Drift: ${summary.driftFiles}`);
  console.log(`Source syntax errors: ${summary.sourceSyntaxErrors}`);
  console.log(`Generated syntax errors: ${summary.generatedSyntaxErrors}`);
  console.log(`Fallback-decoded files: ${summary.fallbackDecodedFiles}`);
  console.log(`Choice target issues before/after: ${summary.choiceTargetIssuesBefore} -> ${summary.choiceTargetIssuesAfter}`);
  console.log(`Choice target increases: ${summary.choiceTargetIncreases}`);
  console.log(`Action multiset drift files: ${summary.actionMultisetDriftFiles}`);
  console.log(`Condition multiset drift files: ${summary.conditionMultisetDriftFiles}`);
  console.log(`Semantic idempotence drift files: ${summary.semanticIdempotenceDriftFiles}`);
  console.log(`Byte idempotence drift files (non-failing): ${summary.byteIdempotenceDriftFiles}`);
  console.log(`Reports:`);
  console.log(`  ${reportPaths.summaryPath}`);
  console.log(`  ${reportPaths.markdownPath}`);
  console.log(`  ${reportPaths.detailsPath}`);
  console.log(`  ${reportPaths.byteIdempotencePath}`);

  const hasFailure = summary.driftFiles > 0 ||
    summary.generatedSyntaxErrors > 0 ||
    summary.choiceTargetIssuesAfter > summary.choiceTargetIssuesBefore;
  if (strict && hasFailure) {
    process.exit(1);
  }
}

main();
