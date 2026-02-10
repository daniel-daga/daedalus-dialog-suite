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

  const sourceSummary = extractModelSummary(sourceVisitor.semanticModel);
  const generatedSummary = extractModelSummary(generatedVisitor.semanticModel);

  const drift = {
    missingDialogs: setDiff(sourceSummary.dialogs, generatedSummary.dialogs),
    extraDialogs: setDiff(generatedSummary.dialogs, sourceSummary.dialogs),
    missingFunctions: setDiff(sourceSummary.functions, generatedSummary.functions),
    extraFunctions: setDiff(generatedSummary.functions, sourceSummary.functions),
    functionCountDrift: [],
    missingChoiceTargetsBefore: sourceSummary.missingChoiceTargets,
    missingChoiceTargetsAfter: generatedSummary.missingChoiceTargets
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
  }

  const hasDrift = drift.missingDialogs.length > 0 ||
    drift.extraDialogs.length > 0 ||
    drift.missingFunctions.length > 0 ||
    drift.extraFunctions.length > 0 ||
    drift.functionCountDrift.length > 0 ||
    drift.missingChoiceTargetsAfter.length !== drift.missingChoiceTargetsBefore.length;

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

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(detailsPath, `${JSON.stringify(details, null, 2)}\n`, 'utf8');

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
    `- Generated at: ${summary.generatedAt}`
  ];

  fs.writeFileSync(markdownPath, `${mdLines.join('\n')}\n`, 'utf8');

  return { summaryPath, markdownPath, detailsPath };
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
  const reportDir = path.resolve(repoRoot, 'reports');

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
    choiceTargetIssuesBefore: details.reduce((sum, d) => sum + ((d.drift && d.drift.missingChoiceTargetsBefore.length) || 0), 0),
    choiceTargetIssuesAfter: details.reduce((sum, d) => sum + ((d.drift && d.drift.missingChoiceTargetsAfter.length) || 0), 0)
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
  console.log(`Reports:`);
  console.log(`  ${reportPaths.summaryPath}`);
  console.log(`  ${reportPaths.markdownPath}`);
  console.log(`  ${reportPaths.detailsPath}`);

  const hasFailure = summary.driftFiles > 0 || summary.generatedSyntaxErrors > 0;
  if (strict && hasFailure) {
    process.exit(1);
  }
}

main();
