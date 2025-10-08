#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const DaedalusFormatter = require('../src/formatter');

function printUsage() {
  console.log(`
Usage: npm run format <file> [options]

Options:
  --indent-size <size>    Number of spaces per indent level (default: 4)
  --indent-tabs          Use tabs instead of spaces for indentation
  --max-line-length <n>  Maximum line length (default: 100)
  --no-comments          Don't preserve comments
  --output <file>        Write to file instead of stdout
  --in-place            Modify file in place
  --help                Show this help

Examples:
  npm run format examples/DEV_2130_Szmyk.d
  npm run format examples/DIA_DEV_2130_Szmyk.d --indent-tabs
  npm run format examples/DEV_2130_Szmyk.d --in-place
  npm run format examples/DIA_DEV_2130_Szmyk.d --output formatted.d
`);
}

function parseArgs(args) {
  const options = {
    indentSize: 4,
    indentType: 'spaces',
    preserveComments: true,
    maxLineLength: 100,
    output: null,
    inPlace: false
  };

  let filePath = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
        printUsage();
        process.exit(0);
        break;

      case '--indent-size':
        if (i + 1 < args.length) {
          options.indentSize = parseInt(args[++i], 10);
          if (isNaN(options.indentSize) || options.indentSize < 1) {
            console.error('Error: indent-size must be a positive number');
            process.exit(1);
          }
        } else {
          console.error('Error: --indent-size requires a value');
          process.exit(1);
        }
        break;

      case '--indent-tabs':
        options.indentType = 'tabs';
        break;

      case '--max-line-length':
        if (i + 1 < args.length) {
          options.maxLineLength = parseInt(args[++i], 10);
          if (isNaN(options.maxLineLength) || options.maxLineLength < 10) {
            console.error('Error: max-line-length must be at least 10');
            process.exit(1);
          }
        } else {
          console.error('Error: --max-line-length requires a value');
          process.exit(1);
        }
        break;

      case '--no-comments':
        options.preserveComments = false;
        break;

      case '--output':
        if (i + 1 < args.length) {
          options.output = args[++i];
        } else {
          console.error('Error: --output requires a file path');
          process.exit(1);
        }
        break;

      case '--in-place':
        options.inPlace = true;
        break;

      default:
        if (arg.startsWith('-')) {
          console.error(`Error: Unknown option '${arg}'`);
          process.exit(1);
        } else if (!filePath) {
          filePath = arg;
        } else {
          console.error('Error: Only one input file is supported');
          process.exit(1);
        }
        break;
    }
  }

  if (!filePath) {
    console.error('Error: Input file is required');
    printUsage();
    process.exit(1);
  }

  if (options.inPlace && options.output) {
    console.error('Error: Cannot use both --in-place and --output options');
    process.exit(1);
  }

  return { filePath, options };
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const { filePath, options } = parseArgs(args);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File '${filePath}' not found`);
    process.exit(1);
  }

  const formatter = new DaedalusFormatter(options);

  try {
    console.error(`Formatting: ${filePath}`);
    const formatted = formatter.formatFile(filePath);

    if (options.inPlace) {
      fs.writeFileSync(filePath, formatted, 'utf8');
      console.error('✓ File formatted in place');
    } else if (options.output) {
      fs.writeFileSync(options.output, formatted, 'utf8');
      console.error(`✓ Formatted output written to ${options.output}`);
    } else {
      // Output to stdout
      process.stdout.write(formatted);
    }
  } catch (error) {
    console.error(`Error formatting file: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
