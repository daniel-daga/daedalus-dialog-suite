#!/usr/bin/env node

const fs = require('fs');
const DaedalusParser = require('../src/parser');

function printUsage() {
  console.log(`
Usage: npm run parse <file> [options]

Options:
  --json          Output as JSON
  --declarations  Show only declarations
  --comments      Show only comments
  --stats         Show parsing statistics
  --help         Show this help

Examples:
  npm run parse examples/DEV_2130_Szmyk.d
  npm run parse examples/DIA_DEV_2130_Szmyk.d --json
  npm run parse examples/DEV_2130_Szmyk.d --declarations
  npm run parse examples/DIA_DEV_2130_Szmyk.d --comments
  npm run parse examples/DIA_DEV_2130_Szmyk.d --stats
`);
}

function formatBytes(bytes) {
  if (bytes === 0) { return '0 B'; }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatTime(ms) {
  if (ms < 1) { return `${(ms * 1000).toFixed(2)}μs`; }
  if (ms < 1000) { return `${ms.toFixed(2)}ms`; }
  return `${(ms / 1000).toFixed(2)}s`;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const filePath = args[0];
  const options = {
    json: args.includes('--json'),
    declarations: args.includes('--declarations'),
    comments: args.includes('--comments'),
    stats: args.includes('--stats')
  };

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File '${filePath}' not found`);
    process.exit(1);
  }

  const parser = new DaedalusParser();

  try {
    console.log(`Parsing: ${filePath}`);
    console.log('─'.repeat(50));

    const result = parser.parseFile(filePath);

    if (options.json) {
      // JSON output
      const output = {
        file: filePath,
        hasErrors: result.hasErrors,
        parseTime: result.parseTime,
        sourceLength: result.sourceLength,
        throughput: result.throughput,
        declarations: parser.extractDeclarations(result)
      };

      console.log(JSON.stringify(output, null, 2));
    } else if (options.declarations) {
      // Declarations only
      const declarations = parser.extractDeclarations(result);

      console.log(`Found ${declarations.length} declarations:\n`);

      declarations.forEach((decl, i) => {
        console.log(`${i + 1}. ${decl.type.toUpperCase()}: ${decl.name}`);
        if (decl.parent) { console.log(`   Extends: ${decl.parent}`); }
        if (decl.returnType) { console.log(`   Returns: ${decl.returnType}`); }
        console.log(`   Location: line ${decl.startPosition.row + 1}, column ${decl.startPosition.column + 1}`);
        console.log();
      });
    } else if (options.comments) {
      // Comments only
      const comments = parser.extractComments(result);

      console.log(`Found ${comments.length} comments:\n`);

      comments.forEach((comment, i) => {
        console.log(`${i + 1}. ${comment.type.toUpperCase()} COMMENT at line ${comment.startPosition.row + 1}:`);
        console.log(`   Content: "${comment.content}"`);
        console.log(`   Raw: ${comment.text}`);
        console.log();
      });
    } else if (options.stats) {
      // Statistics only
      console.log(`File Size: ${formatBytes(result.sourceLength)}`);
      console.log(`Parse Time: ${formatTime(result.parseTime)}`);
      console.log(`Throughput: ${formatBytes(result.throughput)}/s`);
      console.log(`Has Errors: ${result.hasErrors ? 'Yes' : 'No'}`);

      const declarations = parser.extractDeclarations(result);
      console.log(`Declarations: ${declarations.length}`);

      const declTypes = declarations.reduce((acc, decl) => {
        acc[decl.type] = (acc[decl.type] || 0) + 1;
        return acc;
      }, {});

      Object.entries(declTypes).forEach(([type, count]) => {
        console.log(`  - ${type}: ${count}`);
      });

      if (result.hasErrors) {
        console.log(`\nErrors: ${result.errors.length}`);
        result.errors.forEach((error, i) => {
          console.log(`  ${i + 1}. ${error.message} at line ${error.position.row + 1}`);
        });
      }
    } else {
      // Default: Parse tree output
      console.log('Parse Result:');
      console.log(`  Status: ${result.hasErrors ? 'ERRORS' : 'SUCCESS'}`);
      console.log(`  Parse Time: ${formatTime(result.parseTime)}`);
      console.log(`  Throughput: ${formatBytes(result.throughput)}/s`);
      console.log(`  File Size: ${formatBytes(result.sourceLength)}`);

      const declarations = parser.extractDeclarations(result);
      console.log(`  Declarations: ${declarations.length}`);

      console.log('\nDeclarations Found:');
      declarations.forEach((decl, i) => {
        const location = `${decl.startPosition.row + 1}:${decl.startPosition.column + 1}`;
        if (decl.type === 'instance') {
          console.log(`  ${i + 1}. Instance '${decl.name}' extends '${decl.parent}' @ ${location}`);
        } else if (decl.type === 'function') {
          console.log(`  ${i + 1}. Function '${decl.returnType} ${decl.name}()' @ ${location}`);
        } else if (decl.type === 'variable') {
          const varKeyword = decl.isConst ? 'const' : 'var';
          const valueText = decl.value ? ` = ${decl.value}` : '';
          console.log(`  ${i + 1}. Variable '${varKeyword} ${decl.varType} ${decl.name}${valueText}' @ ${location}`);
        } else if (decl.type === 'class') {
          console.log(`  ${i + 1}. Class '${decl.name}' @ ${location}`);
        } else if (decl.type === 'prototype') {
          console.log(`  ${i + 1}. Prototype '${decl.name}' extends '${decl.parent}' @ ${location}`);
        }
      });

      if (result.hasErrors) {
        console.log('\nSyntax Errors:');
        result.errors.forEach((error, i) => {
          console.log(`  ${i + 1}. ${error.message} at line ${error.position.row + 1}`);
        });
      }

      console.log('\nParse Tree:');
      console.log('  (Use tree-sitter CLI for detailed tree: npx tree-sitter parse <file>)');
    }
  } catch (error) {
    console.error(`Error parsing file: ${error.message}`);

    console.error(error.stack);

    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
