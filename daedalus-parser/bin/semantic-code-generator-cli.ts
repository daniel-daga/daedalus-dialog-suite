#!/usr/bin/env ts-node

// CLI tool for generating Daedalus code from semantic model
// Demonstrates round-trip: Parse -> Semantic Model -> Generate

import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { SemanticModelBuilderVisitor } from '../src/semantic/semantic-visitor-index';
import { SemanticCodeGenerator, CodeGeneratorOptions } from '../src/codegen/generator';
import { createDaedalusParser, validateDaedalusFile } from '../src/utils/parser-utils';

interface CLIOptions extends CodeGeneratorOptions {
  output?: string;
  verbose?: boolean;
  encoding?: string;
  outputEncoding?: string;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  // Parse command line arguments
  const options: CLIOptions = {
    indentSize: 1,
    indentChar: '\t',
    includeComments: true,
    sectionHeaders: true,
    uppercaseKeywords: false
  };

  let inputFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--encoding':
      case '--output-encoding': {
        const encoding = args[++i];
        if (!encoding || !iconv.encodingExists(encoding)) {
          console.error(`Unknown or missing encoding for ${arg}: ${encoding ?? ''}`);
          process.exit(1);
        }
        if (arg === '--encoding') options.encoding = encoding;
        else options.outputEncoding = encoding;
        break;
      }
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--indent-spaces':
        options.indentChar = ' ';
        options.indentSize = parseInt(args[++i]) || 4;
        break;
      case '--no-comments':
        options.includeComments = false;
        break;
      case '--no-headers':
        options.sectionHeaders = false;
        break;
      case '--uppercase':
        options.uppercaseKeywords = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          inputFile = arg;
        } else {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  if (!inputFile) {
    console.error('Error: No input file specified');
    printHelp();
    process.exit(1);
  }

  // Process the file
  try {
    processFile(inputFile, options);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function processFile(filename: string, options: CLIOptions) {
  if (options.verbose) {
    console.log(`📄 Processing file: ${filename}`);
  }

  // Validate file
  validateDaedalusFile(filename);

  // Short scripts do not provide enough language text for reliable statistical
  // detection. Prefer valid UTF-8; otherwise use Gothic's Windows-1252 default.
  // Other legacy encodings can be selected explicitly.
  const buffer = fs.readFileSync(filename);
  const utf8 = buffer.toString('utf8');
  const inputEncoding = options.encoding ?? (Buffer.from(utf8, 'utf8').equals(buffer) ? 'utf8' : 'windows-1252');
  const sourceCode = iconv.decode(buffer, inputEncoding);
  const parser = createDaedalusParser();
  const tree = parser.parse(sourceCode);

  if (options.verbose) {
    console.log(`📊 Source size: ${sourceCode.length} characters`);
    console.log('🔍 Parsing...');
  }

  // Parse with tree-sitter
  if (tree.hasErrors) {
    throw new Error(`Source has syntax errors; refusing to format: ${tree.errors?.map(error => error.message).join('; ')}`);
  }

  // Build semantic model
  if (options.verbose) {
    console.log('🏗️  Building semantic model...');
  }

  const visitor = new SemanticModelBuilderVisitor();
  visitor.checkForSyntaxErrors(tree.rootNode);
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const dialogCount = Object.keys(visitor.semanticModel.dialogs).length;
  const functionCount = Object.keys(visitor.semanticModel.functions).length;

  if (options.verbose) {
    console.log(`✅ Found ${dialogCount} dialogs and ${functionCount} functions`);
    console.log('🔨 Generating code...');
  }

  // Generate code
  const generatorOptions: CodeGeneratorOptions = {};
  if (options.indentSize !== undefined) generatorOptions.indentSize = options.indentSize;
  if (options.indentChar !== undefined) generatorOptions.indentChar = options.indentChar;
  if (options.includeComments !== undefined) generatorOptions.includeComments = options.includeComments;
  if (options.sectionHeaders !== undefined) generatorOptions.sectionHeaders = options.sectionHeaders;
  if (options.uppercaseKeywords !== undefined) generatorOptions.uppercaseKeywords = options.uppercaseKeywords;

  const generator = new SemanticCodeGenerator(generatorOptions);

  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  if (options.verbose) {
    console.log(`📝 Generated ${generatedCode.length} characters`);
  }

  // Validate before writing, even without verbose reporting. Malformed input
  // and generated syntax must never replace an existing destination.
  const tree2 = parser.parse(generatedCode);
  if (tree2.hasErrors) {
    throw new Error('Generated code has parse errors; refusing to write output');
  }

  // Verify round-trip if verbose
  if (options.verbose) {
    console.log('\n🔄 Verifying round-trip...');
    const visitor2 = new SemanticModelBuilderVisitor();
    visitor2.pass1_createObjects(tree2.rootNode);
    visitor2.pass2_analyzeAndLink(tree2.rootNode);

    const dialogCount2 = Object.keys(visitor2.semanticModel.dialogs).length;
    const functionCount2 = Object.keys(visitor2.semanticModel.functions).length;

    if (dialogCount === dialogCount2 && functionCount === functionCount2) {
      console.log(`✅ Round-trip successful! (${dialogCount} dialogs, ${functionCount} functions)`);
    } else {
      console.error(`❌ Round-trip failed! Original: ${dialogCount}/${functionCount}, Generated: ${dialogCount2}/${functionCount2}`);
      process.exit(1);
    }
  }

  if (options.output) {
    const encoding = options.outputEncoding ?? inputEncoding;
    const encoded = iconv.encode(generatedCode, encoding);
    if (iconv.decode(encoded, encoding) !== generatedCode) {
      throw new Error(`Output encoding ${encoding} cannot represent the generated source; refusing to write output`);
    }
    fs.writeFileSync(options.output, encoded);
    console.log(`✅ Written to: ${options.output}`);
  } else {
    console.log(generatedCode);
  }
}

function printHelp() {
  console.log('Daedalus Semantic Code Generator CLI');
  console.log('');
  console.log('Usage: npm run format -- <file.d> [options]');
  console.log('');
  console.log('Generate Daedalus source code from semantic model (round-trip demo)');
  console.log('');
  console.log('Options:');
  console.log('  -o, --output <file>         Write output to file (default: stdout)');
  console.log('  --encoding <name>           Input encoding (default: valid UTF-8, otherwise Windows-1252)');
  console.log('  --output-encoding <name>    Output file encoding (default: source encoding)');
  console.log('  --indent-spaces <n>         Use spaces for indentation (default: tabs)');
  console.log('  --no-comments               Omit inline comments');
  console.log('  --no-headers                Omit section header comments');
  console.log('  --uppercase                 Use uppercase keywords (INSTANCE, FUNC)');
  console.log('  -v, --verbose               Verbose output with statistics');
  console.log('  -h, --help                  Show this help');
  console.log('');
  console.log('Examples:');
  console.log('  npm run format -- examples/DIA_Szmyk.d');
  console.log('  npm run format -- examples/DIA_Szmyk.d -o output.d --verbose');
  console.log('  npm run format -- examples/DIA_Szmyk.d --indent-spaces 4 --no-comments');
}

// Run if called directly
if (require.main === module) {
  main();
}