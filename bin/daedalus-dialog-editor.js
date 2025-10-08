#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const DaedalusParser = require('../src/parser');

function showHelp() {
  console.log(`
Daedalus Parser & Editor
Usage: daedalus-dialog-editor <command> [options]

Commands:
  parse <file>              Parse and interpret Daedalus file (dialogs & NPCs)
  edit <file>               Interactive edit mode for dialog file
  convert <input> <output>  Convert Daedalus to JSON and back
  validate <file>           Validate Daedalus structure
  list <file>               List all dialogs in file
  list-npcs <file>          List all NPCs in file
  extract <file> <dialog>   Extract specific dialog to JSON
  extract-npc <file> <npc>  Extract specific NPC to JSON

Options:
  --help, -h               Show this help message
  --output, -o <file>      Output file (for convert, extract)
  --format <json|daedalus> Output format (default: json)
  --pretty                 Pretty print JSON output
  --no-comments            Exclude comments in generated code

Examples:
  daedalus-dialog-editor parse examples/DIA_DEV_2130_Szmyk.d
  daedalus-dialog-editor parse reference/SLD_99003_Farim.d
  daedalus-dialog-editor list-npcs reference/SLD_99003_Farim.d
  daedalus-dialog-editor convert input.d output.json
  daedalus-dialog-editor edit examples/DIA_DEV_2130_Szmyk.d
  daedalus-dialog-editor list examples/DIA_DEV_2130_Szmyk.d
`);
}

function parseDialogFile(filePath, options = {}) {
  try {
    const parser = new DaedalusParser();
    const parseResult = parser.parseFile(filePath, { includeSource: true });

    if (parseResult.hasErrors) {
      console.error(`Parse errors in ${filePath}:`);
      const validation = parser.validate(fs.readFileSync(filePath, 'utf8'));
      validation.errors.forEach(error => {
        console.error(`  ${error.type}: ${error.message}`);
      });
      process.exit(1);
    }

    const dialogResult = parser.interpretDialogs(parseResult);
    return dialogResult;
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error.message);
    process.exit(1);
  }
}

function parseFile(filePath, options = {}) {
  try {
    const parser = new DaedalusParser();
    const parseResult = parser.parseFile(filePath, { includeSource: true });

    if (parseResult.hasErrors) {
      console.error(`Parse errors in ${filePath}:`);
      const validation = parser.validate(fs.readFileSync(filePath, 'utf8'));
      validation.errors.forEach(error => {
        console.error(`  ${error.type}: ${error.message}`);
      });
      process.exit(1);
    }

    const result = parser.interpretAll(parseResult);
    return result;
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error.message);
    process.exit(1);
  }
}

function handleParseCommand(filePath, options) {
  console.log(`Parsing Daedalus file: ${filePath}`);

  const result = parseFile(filePath, options);

  console.log('\nParse Results:');
  console.log(`  Total NPCs: ${result.metadata.totalNPCs}`);
  console.log(`  Total dialogs: ${result.metadata.totalDialogs}`);
  console.log(`  Total dialog NPCs: ${result.metadata.totalDialogNPCs}`);
  console.log(`  Related functions: ${result.metadata.relatedFunctions}`);
  console.log(`  Parse time: ${result.metadata.parseTime.toFixed(2)}ms`);

  if (Object.keys(result.npcs).length > 0) {
    console.log('\nNPC instances:');
    for (const [npcName, npcData] of Object.entries(result.npcs)) {
      console.log(`  ${npcName} (${npcData.parent}): ${npcData.npcName || 'unnamed'}`);
    }
  }

  if (Object.keys(result.dialogNpcs).length > 0) {
    console.log('\nNPCs with dialogs:');
    for (const [npcName, npcData] of Object.entries(result.dialogNpcs)) {
      console.log(`  ${npcName}: ${npcData.dialogs.length} dialog(s)`);
    }
  }

  if (options.pretty) {
    console.log('\nFull Structure:');
    console.log(JSON.stringify(result, null, 2));
  }
}

function handleListCommand(filePath, options) {
  const result = parseDialogFile(filePath, options);

  console.log(`Dialogs in ${path.basename(filePath)}:\n`);

  let dialogIndex = 1;
  Object.values(result.npcs).forEach(npc => {
    npc.dialogs.forEach((dialog) => {
      console.log(`${dialogIndex++}. ${dialog.name}`);
      if (dialog.npc) {
        console.log(`   NPC: ${dialog.npc}`);
      }
      if (dialog.nr) {
        console.log(`   Number: ${dialog.nr}`);
      }
      if (dialog.description) {
        console.log(`   Description: ${dialog.description}`);
      }
      if (dialog.permanent !== null) {
        console.log(`   Permanent: ${dialog.permanent}`);
      }

      // Show dialog flow information
      if (dialog.dialogFlow) {
        console.log('   Dialog Flow:');
        console.log(`     Lines: ${dialog.dialogFlow.totalLines}`);
        console.log(`     Choices: ${dialog.dialogFlow.totalChoices}`);
        console.log(`     Has Actions: ${dialog.dialogFlow.hasActions}`);

        // Show actual dialog lines
        if (dialog.dialogFlow.steps && dialog.dialogFlow.steps.length > 0) {
          const lines = dialog.dialogFlow.steps.filter(step => step.type === 'line');
          if (lines.length > 0) {
            console.log('     Preview:');
            lines.slice(0, 2).forEach(line => {
              const speaker = line.speaker === 'self' ? dialog.npc : (line.speaker === 'other' ? 'Player' : line.speaker);
              const text = line.text || `[${line.dialogId}]`;
              console.log(`       ${speaker}: ${text}`);
            });
            if (lines.length > 2) {
              console.log(`       ... and ${lines.length - 2} more line(s)`);
            }
          }
        }
      }

      // Show condition logic
      if (dialog.conditionLogic && dialog.conditionLogic.returnValue) {
        console.log(`   Condition: ${dialog.conditionLogic.returnValue}`);
      }

      console.log('');
    });
  });
}

function handleConvertCommand(inputPath, outputPath, options) {
  let result;

  // Check if input is JSON or Daedalus
  const inputContent = fs.readFileSync(inputPath, 'utf8');
  const isJsonInput = inputPath.endsWith('.json') || inputContent.trim().startsWith('{');

  if (isJsonInput) {
    // Parse JSON input
    try {
      result = JSON.parse(inputContent);
    } catch (error) {
      console.error(`Error parsing JSON file: ${error.message}`);
      process.exit(1);
    }
  } else {
    // Parse Daedalus input using unified parser
    result = parseFile(inputPath, options);
  }

  let output;
  const outputFormat = options.format || (isJsonInput ? 'daedalus' : 'json');

  if (outputFormat === 'json') {
    output = JSON.stringify(result, null, options.pretty ? 2 : 0);
  } else if (outputFormat === 'daedalus') {
    const parser = new DaedalusParser();
    const generateOptions = {
      includeComments: !options.noComments,
      indentSize: 4
    };
    output = parser.generateDaedalus(result, generateOptions);
  } else {
    console.error(`Unknown format: ${outputFormat}`);
    process.exit(1);
  }

  if (outputPath) {
    fs.writeFileSync(outputPath, output, 'utf8');
    console.log(`Converted ${inputPath} to ${outputPath} (${outputFormat})`);
  } else {
    console.log(output);
  }
}

function handleExtractCommand(filePath, dialogName, options) {
  const result = parseDialogFile(filePath, options);

  // Find dialog across all NPCs
  let dialog = null;
  for (const npc of Object.values(result.npcs)) {
    dialog = npc.dialogs.find(d => d.name === dialogName);
    if (dialog) { break; }
  }

  if (!dialog) {
    console.error(`Dialog '${dialogName}' not found in ${filePath}`);
    console.log('Available dialogs:');
    Object.values(result.npcs).forEach(npc => {
      npc.dialogs.forEach(d => console.log(`  - ${d.name}`));
    });
    process.exit(1);
  }

  const extractedData = {
    dialog
  };

  const output = JSON.stringify(extractedData, null, options.pretty ? 2 : 0);

  if (options.output) {
    fs.writeFileSync(options.output, output, 'utf8');
    console.log(`Extracted dialog '${dialogName}' to ${options.output}`);
  } else {
    console.log(output);
  }
}

function handleListNpcsCommand(filePath, options) {
  const result = parseFile(filePath, options);

  console.log(`NPCs in ${path.basename(filePath)}:\n`);

  if (Object.keys(result.npcs).length === 0) {
    console.log('No NPC instances found.');
    return;
  }

  let npcIndex = 1;
  Object.values(result.npcs).forEach(npc => {
    console.log(`${npcIndex++}. ${npc.name} (${npc.parent})`);
    if (npc.npcName) {
      console.log(`   Name: ${npc.npcName}`);
    }
    if (npc.guild) {
      console.log(`   Guild: ${npc.guild}`);
    }
    if (npc.id !== null && npc.id !== undefined) {
      console.log(`   ID: ${npc.id}`);
    }
    if (npc.voice !== null && npc.voice !== undefined) {
      console.log(`   Voice: ${npc.voice}`);
    }
    if (npc.level !== null && npc.level !== undefined) {
      console.log(`   Level: ${npc.level}`);
    }

    // Show attributes
    if (npc.attributes && Object.keys(npc.attributes).length > 0) {
      console.log(`   Attributes: ${Object.keys(npc.attributes).length} set`);
    }

    // Show function calls
    if (npc.functionCalls && npc.functionCalls.length > 0) {
      console.log(`   Function calls: ${npc.functionCalls.length}`);
    }

    console.log('');
  });
}

function handleExtractNpcCommand(filePath, npcName, options) {
  const result = parseFile(filePath, options);

  // Find NPC
  const npc = result.npcs[npcName];

  if (!npc) {
    console.error(`NPC '${npcName}' not found in ${filePath}`);
    console.log('Available NPCs:');
    Object.keys(result.npcs).forEach(name => {
      console.log(`  - ${name}`);
    });
    process.exit(1);
  }

  const extractedData = {
    npc
  };

  const output = JSON.stringify(extractedData, null, options.pretty ? 2 : 0);

  if (options.output) {
    fs.writeFileSync(options.output, output, 'utf8');
    console.log(`Extracted NPC '${npcName}' to ${options.output}`);
  } else {
    console.log(output);
  }
}

function handleValidateCommand(filePath, options) {
  console.log(`Validating dialog file: ${filePath}`);

  try {
    const parser = new DaedalusParser();
    const validation = parser.validate(fs.readFileSync(filePath, 'utf8'));

    if (validation.isValid) {
      console.log('✓ File is valid');

      // Additional dialog-specific validation
      const parseResult = parser.parseFile(filePath, { includeSource: true });
      const dialogResult = parser.interpretDialogs(parseResult);

      const issues = [];

      Object.values(dialogResult.npcs).forEach(npc => {
        npc.dialogs.forEach(dialog => {
          if (!dialog.npc) {
            issues.push(`Dialog '${dialog.name}' missing required 'npc' property`);
          }
          if (!dialog.condition) {
            issues.push(`Dialog '${dialog.name}' missing 'condition' function`);
          }
          if (!dialog.information) {
            issues.push(`Dialog '${dialog.name}' missing 'information' function`);
          }
        });
      });

      if (issues.length > 0) {
        console.log('\n⚠ Dialog structure warnings:');
        issues.forEach(issue => console.log(`  - ${issue}`));
      } else {
        console.log('✓ Dialog structure is valid');
      }
    } else {
      console.log('✗ File has syntax errors:');
      validation.errors.forEach(error => {
        console.log(`  ${error.type}: ${error.message}`);
      });
      process.exit(1);
    }
  } catch (error) {
    console.error('Validation failed:', error.message);
    process.exit(1);
  }
}

function handleEditCommand(filePath, options) {
  console.log('Interactive editing mode not implemented yet.');
  console.log('You can use \'convert\' command to extract to JSON, edit manually, and convert back.');
  console.log('\nExample workflow:');
  console.log(`1. daedalus-dialog-editor convert ${filePath} ${filePath}.json`);
  console.log('2. # Edit the JSON file with your preferred editor');
  console.log(`3. daedalus-dialog-editor convert ${filePath}.json ${filePath} --format daedalus`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  const command = args[0];
  const options = {};

  // Parse options
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--pretty') {
      options.pretty = true;
    } else if (args[i] === '--no-comments') {
      options.noComments = true;
    } else if (args[i] === '--output' || args[i] === '-o') {
      options.output = args[++i];
    } else if (args[i] === '--format') {
      options.format = args[++i];
    }
  }

  switch (command) {
    case 'parse':
      if (args.length < 2) {
        console.error('Error: parse command requires a file path');
        process.exit(1);
      }
      handleParseCommand(args[1], options);
      break;

    case 'list':
      if (args.length < 2) {
        console.error('Error: list command requires a file path');
        process.exit(1);
      }
      handleListCommand(args[1], options);
      break;

    case 'convert':
      if (args.length < 3) {
        console.error('Error: convert command requires input and output paths');
        process.exit(1);
      }
      handleConvertCommand(args[1], args[2], options);
      break;

    case 'extract':
      if (args.length < 3) {
        console.error('Error: extract command requires file path and dialog name');
        process.exit(1);
      }
      handleExtractCommand(args[1], args[2], options);
      break;

    case 'list-npcs':
      if (args.length < 2) {
        console.error('Error: list-npcs command requires a file path');
        process.exit(1);
      }
      handleListNpcsCommand(args[1], options);
      break;

    case 'extract-npc':
      if (args.length < 3) {
        console.error('Error: extract-npc command requires file path and NPC name');
        process.exit(1);
      }
      handleExtractNpcCommand(args[1], args[2], options);
      break;

    case 'validate':
      if (args.length < 2) {
        console.error('Error: validate command requires a file path');
        process.exit(1);
      }
      handleValidateCommand(args[1], options);
      break;

    case 'edit':
      if (args.length < 2) {
        console.error('Error: edit command requires a file path');
        process.exit(1);
      }
      handleEditCommand(args[1], options);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log('Use --help for usage information');
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseDialogFile,
  handleParseCommand,
  handleListCommand,
  handleConvertCommand,
  handleExtractCommand,
  handleValidateCommand
};
