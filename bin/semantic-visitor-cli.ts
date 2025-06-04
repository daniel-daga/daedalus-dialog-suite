#!/usr/bin/env npx ts-node

// CLI tool for running semantic visitor on Daedalus files

import * as fs from 'fs';
import * as path from 'path';
import * as Parser from 'tree-sitter';
import {
  DialogFunction,
  DialogLine,
  CreateTopic,
  LogEntry,
  LogSetTopicStatus,
  Action,
  Choice,
  CreateInventoryItems,
  GiveInventoryItems,
  AttackAction,
  SetAttitudeAction,
  ExchangeRoutineAction,
  ChapterTransitionAction,
  TreeSitterNode,
  SemanticModelBuilderVisitor
} from '../src/semantic-visitor-index';

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npm run semantic <file.d>');
    console.log('');
    console.log('Analyze a Daedalus dialog file with the semantic visitor');
    console.log('');
    console.log('Examples:');
    console.log('  npm run semantic examples/DIA_Szmyk.d');
    console.log('  npm run semantic -- --help');
    process.exit(1);
  }

  const filename = args[0];

  if (filename === '--help' || filename === '-h') {
    console.log('Daedalus Semantic Visitor CLI');
    console.log('');
    console.log('Usage: npm run semantic <file.d>');
    console.log('');
    console.log('This tool parses a Daedalus dialog file and builds a semantic model');
    console.log('showing dialogs, functions, and semantic actions in execution order.');
    console.log('');
    console.log('Output includes:');
    console.log('  - AST structure (debug output)');
    console.log('  - Semantic model with dialogs and actions');
    console.log('  - Object linking verification');
    process.exit(0);
  }

  if (!fs.existsSync(filename)) {
    console.error(`Error: File '${filename}' not found`);
    process.exit(1);
  }

  const ext = path.extname(filename);
  if (ext !== '.d') {
    console.warn(`Warning: Expected .d file extension, got '${ext}'`);
  }

  try {
    console.log(`🔍 Analyzing file: ${filename}`);
    console.log('');

    // Read and parse the file
    const sourceCode = fs.readFileSync(filename, 'utf8');
    const Parser = require('tree-sitter');
    const Daedalus = require('../bindings/node');
    const parser = new Parser();
    parser.setLanguage(Daedalus);

    const tree = parser.parse(sourceCode);

    // Print AST structure for debugging
    //console.log('--- 🌳 AST Structure ---');
    //printTree(tree.rootNode);
    //console.log('');

    // Run semantic analysis
    const visitor = new SemanticModelBuilderVisitor();

    console.log('--- 📊 Semantic Analysis ---');
    console.log('Running Pass 1: Creating all objects...');
    visitor.pass1_createObjects(tree.rootNode);

    const functionCount = Object.keys(visitor.semanticModel.functions).length;
    const dialogCount = Object.keys(visitor.semanticModel.dialogs).length;
    console.log(`Found ${functionCount} functions and ${dialogCount} dialogs.`);

    console.log('Running Pass 2: Linking properties and analyzing bodies...');
    visitor.pass2_analyzeAndLink(tree.rootNode);
    console.log('');

    // Display results
    console.log('--- ✅ Semantic Model ---');

    // Create a display version that shows function actions
    const displayModel = {
      dialogs: visitor.semanticModel.dialogs,
      functions: Object.fromEntries(
        Object.entries(visitor.semanticModel.functions).map(([name, func]) => [
          name,
          {
            name: func.name,
            returnType: func.returnType,
            actions: func.actions
          }
        ])
      )
    };

    console.log(JSON.stringify(displayModel, jsonReplacer, 2));
    console.log('');

    // Verification
    console.log('--- 🔗 Verification ---');
    let verificationCount = 0;
    let successCount = 0;

    for (const dialogName in visitor.semanticModel.dialogs) {
      const dialog = visitor.semanticModel.dialogs[dialogName];

      // Check condition function linking
      if (dialog.properties.condition && dialog.properties.condition instanceof DialogFunction) {
        const conditionName = dialog.properties.condition.name;
        const conditionFunc = visitor.semanticModel.functions[conditionName];
        verificationCount++;
        if (dialog.properties.condition === conditionFunc) {
          successCount++;
        }
        console.log(`Dialog '${dialogName}' condition links to function '${conditionName}': ${dialog.properties.condition === conditionFunc ? '✅' : '❌'}`);
      }

      // Check information function linking
      if (dialog.properties.information && dialog.properties.information instanceof DialogFunction) {
        const infoName = dialog.properties.information.name;
        const infoFunc = visitor.semanticModel.functions[infoName];
        verificationCount++;
        if (dialog.properties.information === infoFunc) {
          successCount++;
        }
        console.log(`Dialog '${dialogName}' information links to function '${infoName}': ${dialog.properties.information === infoFunc ? '✅' : '❌'}`);
      }
    }

    console.log(`\nVerification: ${successCount}/${verificationCount} object links verified successfully`);

    // Summary
    console.log('');
    console.log('--- 📈 Summary ---');
    console.log(`File: ${filename}`);
    console.log(`Size: ${sourceCode.length} characters`);
    console.log(`Dialogs: ${dialogCount}`);
    console.log(`Functions: ${functionCount}`);

    // Count actions from both dialogs and functions
    let totalActions = 0;
    let actionTypes = {
      DialogLine: 0, CreateTopic: 0, LogEntry: 0, LogSetTopicStatus: 0, Action: 0, Choice: 0,
      CreateInventoryItems: 0, GiveInventoryItems: 0, AttackAction: 0, SetAttitudeAction: 0,
      ExchangeRoutineAction: 0, ChapterTransitionAction: 0
    };

    // Count dialog actions
    for (const dialog of Object.values(visitor.semanticModel.dialogs)) {
      totalActions += dialog.actions.length;
      dialog.actions.forEach(action => {
        if (action instanceof DialogLine) actionTypes.DialogLine++;
        else if (action instanceof CreateTopic) actionTypes.CreateTopic++;
        else if (action instanceof LogEntry) actionTypes.LogEntry++;
        else if (action instanceof LogSetTopicStatus) actionTypes.LogSetTopicStatus++;
        else if (action instanceof Choice) actionTypes.Choice++;
        else if (action instanceof CreateInventoryItems) actionTypes.CreateInventoryItems++;
        else if (action instanceof GiveInventoryItems) actionTypes.GiveInventoryItems++;
        else if (action instanceof AttackAction) actionTypes.AttackAction++;
        else if (action instanceof SetAttitudeAction) actionTypes.SetAttitudeAction++;
        else if (action instanceof ExchangeRoutineAction) actionTypes.ExchangeRoutineAction++;
        else if (action instanceof ChapterTransitionAction) actionTypes.ChapterTransitionAction++;
        else if (action instanceof Action) actionTypes.Action++;
      });
    }

    // Count function actions (note: this includes dialog information functions too, so some duplication)
    let totalFunctionActions = 0;
    for (const func of Object.values(visitor.semanticModel.functions)) {
      totalFunctionActions += func.actions.length;
    }

    console.log(`Total Dialog Actions: ${totalActions}`);
    console.log(`Total Function Actions: ${totalFunctionActions}`);
    if (totalActions > 0) {
      console.log(`Dialog Action Breakdown:`);
      console.log(`  - Dialog Lines: ${actionTypes.DialogLine}`);
      console.log(`  - Choices: ${actionTypes.Choice}`);
      console.log(`  - Create Topic: ${actionTypes.CreateTopic}`);
      console.log(`  - Log Entries: ${actionTypes.LogEntry}`);
      console.log(`  - Set Topic Status: ${actionTypes.LogSetTopicStatus}`);
      console.log(`  - Create Inventory Items: ${actionTypes.CreateInventoryItems}`);
      console.log(`  - Give Inventory Items: ${actionTypes.GiveInventoryItems}`);
      console.log(`  - Attack Actions: ${actionTypes.AttackAction}`);
      console.log(`  - Set Attitude Actions: ${actionTypes.SetAttitudeAction}`);
      console.log(`  - Exchange Routine Actions: ${actionTypes.ExchangeRoutineAction}`);
      console.log(`  - Chapter Transition Actions: ${actionTypes.ChapterTransitionAction}`);
      console.log(`  - Generic Actions: ${actionTypes.Action}`);
    }

  } catch (error) {
    console.error('Error during analysis:', error);
    process.exit(1);
  }
}

// Helper function to print AST tree
function printTree(node: TreeSitterNode, indent: number = 0): void {
  const prefix = '  '.repeat(indent);
  const textSnippet = node.text.replace(/\n/g, "\\n");
  console.log(`${prefix}- type: ${node.type}, text: "${textSnippet}"`);

  for (const child of node.namedChildren) {
    printTree(child, indent + 1);
  }
}

// JSON replacer for pretty printing semantic objects
function jsonReplacer(key: string, value: any): any {
  if (value instanceof DialogFunction) {
    return `[Link to Function: ${value.name}]`;
  }
  if (value instanceof DialogLine) {
    return `[DialogLine: ${value.speaker} -> "${value.text}"]`;
  }
  if (value instanceof CreateTopic) {
    return `[CreateTopic: ${value.topic}${value.topicType ? `, ${value.topicType}` : ''}]`;
  }
  if (value instanceof LogEntry) {
    return `[LogEntry: ${value.topic} -> "${value.text}"]`;
  }
  if (value instanceof LogSetTopicStatus) {
    return `[LogSetTopicStatus: ${value.topic} -> ${value.status}]`;
  }
  if (value instanceof Choice) {
    return `[Choice: "${value.text}" -> ${value.targetFunction}]`;
  }
  if (value instanceof CreateInventoryItems) {
    return `[CreateItems: ${value.target} gets ${value.quantity}x ${value.item}]`;
  }
  if (value instanceof GiveInventoryItems) {
    return `[GiveItems: ${value.giver} gives ${value.receiver} ${value.quantity}x ${value.item}]`;
  }
  if (value instanceof AttackAction) {
    return `[Attack: ${value.attacker} attacks ${value.target} (${value.attackReason}, dmg:${value.damage})]`;
  }
  if (value instanceof SetAttitudeAction) {
    return `[SetAttitude: ${value.target} -> ${value.attitude}]`;
  }
  if (value instanceof ExchangeRoutineAction) {
    return `[ExchangeRoutine: ${value.target} -> "${value.routine}"]`;
  }
  if (value instanceof ChapterTransitionAction) {
    return `[ChapterTransition: Chapter ${value.chapter} in ${value.world}]`;
  }
  if (value instanceof Action) {
    return `[Action: ${value.action}]`;
  }
  return value;
}

// Run if called directly
if (require.main === module) {
  main();
}