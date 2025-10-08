// Example usage and demo of the semantic visitor

import * as Parser from 'tree-sitter';
import { SemanticModelBuilderVisitor } from './semantic-visitor';
import {
  DialogFunction,
  DialogLine,
  CreateTopic,
  LogEntry,
  LogSetTopicStatus,
  Action,
  TreeSitterNode
} from './semantic-model';

// Only run example when this file is executed directly
if (require.main === module) {
  const Parser = require('tree-sitter');
  const Daedalus = require('../bindings/node');
  const parser = new Parser();
  parser.setLanguage(Daedalus);

  const sourceCode = `
// ************************************************************
//                          EXIT
// ************************************************************

instance DIA_Szmyk_EXIT(C_INFO)
{
    npc         = DEV_2130_Szmyk;
    nr          = 999;
    condition   = DIA_Szmyk_EXIT_Condition;
    information = DIA_Szmyk_EXIT_Info;
    permanent   = true;
    description = DIALOG_ENDE;
};

func int DIA_Szmyk_EXIT_Condition()
{
    return true;
};

func void DIA_Szmyk_EXIT_Info()
{
    AI_StopProcessInfos (self);
};

// ************************************************************
//                         Hello
// ************************************************************

instance DIA_Szmyk_Hello (C_INFO)
{
    npc         = DEV_2130_Szmyk;
    nr          = 1;
    condition   = DIA_Szmyk_Hello_Condition;
    information = DIA_Szmyk_Hello_Info;
    permanent   = false;
    important   = true;
};

func int DIA_Szmyk_Hello_Condition()
{
    return true;
};

func void DIA_Szmyk_Hello_Info()
{
    AI_Output (self, other,"DIA_Szmyk_Hello_13_00"); //Welcome to Gothic Mod Build Tool example mod!
    Log_CreateTopic (TOPIC_Quest, LOG_MISSION);
    B_LogEntry (TOPIC_Quest, "Started the example quest");
    Info_ClearChoices (DIA_Szmyk_Hello);
    AI_StopProcessInfos (self);
};
`;

  // Parse and analyze
  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();

  console.log('--- Parsed AST Structure ---');
  printTree(tree.rootNode);

  console.log('Running Pass 1: Creating all objects...');
  visitor.pass1_createObjects(tree.rootNode);
  console.log(`Found ${Object.keys(visitor.semanticModel.functions).length} functions and ${Object.keys(visitor.semanticModel.dialogs).length} dialogs.`);

  console.log('Running Pass 2: Linking properties and analyzing bodies...');
  visitor.pass2_analyzeAndLink(tree.rootNode);

  console.log('\n--- ✅ Final Semantic Model ---');
  console.log(JSON.stringify(visitor.semanticModel, jsonReplacer, 2));

  // Verification
  const helloDialog = visitor.semanticModel.dialogs.DIA_Szmyk_Hello;
  const helloConditionFunc = visitor.semanticModel.functions.DIA_Szmyk_Hello_Condition;
  console.log('\n--- Verification ---');
  console.log('Is the dialog\'s condition property a direct link to the function object?', helloDialog.properties.condition === helloConditionFunc);

  // Helper functions
  function printTree(node: TreeSitterNode, indent: number = 0): void {
    const prefix = '  '.repeat(indent);
    const textSnippet = node.text.replace(/\n/g, "\\n");
    console.log(`${prefix}- type: ${node.type}, text: "${textSnippet}"`);

    for (const child of node.namedChildren) {
      printTree(child, indent + 1);
    }
  }

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
    if (value instanceof Action) {
      return `[Action: ${value.action}]`;
    }
    return value;
  }
}