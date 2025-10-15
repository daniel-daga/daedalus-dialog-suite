const { test } = require('node:test');
const assert = require('node:assert');
const { createParser, assertIncludes } = require('./helpers');
const { SemanticCodeGenerator } = require('../dist/semantic-code-generator');
const { SemanticModelBuilderVisitor } = require('../dist/semantic-visitor-index');

// Initialize parser
const parser = createParser();

test('SemanticCodeGenerator should be a constructor', () => {
  assert.equal(typeof SemanticCodeGenerator, 'function');
});

test('SemanticCodeGenerator should create instance with default options', () => {
  const generator = new SemanticCodeGenerator();
  assert.ok(generator instanceof SemanticCodeGenerator);
});

test('SemanticCodeGenerator should accept custom options', () => {
  const options = { indentSize: 4, indentChar: ' ', includeComments: false };
  const generator = new SemanticCodeGenerator(options);
  assert.ok(generator instanceof SemanticCodeGenerator);
});

test('SemanticCodeGenerator should have generateSemanticModel method', () => {
  const generator = new SemanticCodeGenerator();
  assert.equal(typeof generator.generateSemanticModel, 'function');
});

test('SemanticCodeGenerator should generate dialog instance', () => {
  const generator = new SemanticCodeGenerator();
  const { Dialog } = require('../dist/semantic-visitor-index');

  const dialog = new Dialog('DIA_Test_Hello', 'C_INFO');
  dialog.properties.npc = 'TEST_NPC';
  dialog.properties.nr = 1;
  dialog.properties.permanent = false;
  dialog.properties.description = 'Test dialog';

  const result = generator.generateDialog(dialog);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('instance DIA_Test_Hello(C_INFO)'));
  assert.ok(result.includes('npc'));
  assert.ok(result.includes('TEST_NPC'));
  assert.ok(result.includes('nr'));
  assert.ok(result.includes('permanent'));
  assert.ok(result.includes('FALSE'));
  assert.ok(result.includes('description'));
});

test('SemanticCodeGenerator should generate function declaration', () => {
  const generator = new SemanticCodeGenerator();
  const { DialogFunction } = require('../dist/semantic-visitor-index');

  const func = new DialogFunction('TestFunc', 'int');
  const result = generator.generateFunction(func);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('func int TestFunc()'));
  assert.ok(result.includes('{'));
  assert.ok(result.includes('};'));
});

test('SemanticCodeGenerator should generate dialog line action', () => {
  const generator = new SemanticCodeGenerator();
  const { DialogLine } = require('../dist/semantic-visitor-index');

  const action = new DialogLine('self', 'Hello world', 'TEST_01');
  const result = generator.generateAction(action);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('AI_Output'));
  assert.ok(result.includes('self'));
  assert.ok(result.includes('TEST_01'));
  assert.ok(result.includes('Hello world')); // Comment should be included by default
});

test('SemanticCodeGenerator should generate choice action', () => {
  const generator = new SemanticCodeGenerator();
  const { Choice } = require('../dist/semantic-visitor-index');

  const action = new Choice('DIA_Test', 'Choose this', 'TestFunc');
  const result = generator.generateAction(action);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('Info_AddChoice'));
  assert.ok(result.includes('DIA_Test'));
  assert.ok(result.includes('Choose this'));
  assert.ok(result.includes('TestFunc'));
});

test('SemanticCodeGenerator should generate create topic action', () => {
  const generator = new SemanticCodeGenerator();
  const { CreateTopic } = require('../dist/semantic-visitor-index');

  const action = new CreateTopic('TOPIC_Quest', 'LOG_MISSION');
  const result = generator.generateAction(action);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('Log_CreateTopic'));
  assert.ok(result.includes('TOPIC_Quest'));
  assert.ok(result.includes('LOG_MISSION'));
});

test('SemanticCodeGenerator should generate log entry action', () => {
  const generator = new SemanticCodeGenerator();
  const { LogEntry } = require('../dist/semantic-visitor-index');

  const action = new LogEntry('TOPIC_Quest', 'Quest started');
  const result = generator.generateAction(action);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('B_LogEntry'));
  assert.ok(result.includes('TOPIC_Quest'));
  assert.ok(result.includes('Quest started'));
});

test('SemanticCodeGenerator round-trip: parse -> generate -> parse', () => {
  const sourceCode = `
instance DIA_Test_Exit(C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 999;
\tcondition\t= DIA_Test_Exit_Condition;
\tinformation\t= DIA_Test_Exit_Info;
\tpermanent\t= TRUE;
\tdescription\t= DIALOG_ENDE;
};

func int DIA_Test_Exit_Condition()
{
\treturn TRUE;
};

func void DIA_Test_Exit_Info()
{
\tAI_StopProcessInfos(self);
};
`;

  // Parse original
  const tree1 = parser.parse(sourceCode);
  const visitor1 = new SemanticModelBuilderVisitor();
  visitor1.pass1_createObjects(tree1.rootNode);
  visitor1.pass2_analyzeAndLink(tree1.rootNode);

  // Generate code
  const generator = new SemanticCodeGenerator({ includeComments: false });
  const generatedCode = generator.generateSemanticModel(visitor1.semanticModel);

  // Parse generated code
  const tree2 = parser.parse(generatedCode);
  const visitor2 = new SemanticModelBuilderVisitor();
  visitor2.pass1_createObjects(tree2.rootNode);
  visitor2.pass2_analyzeAndLink(tree2.rootNode);

  // Compare semantic models
  assert.equal(
    Object.keys(visitor2.semanticModel.dialogs).length,
    Object.keys(visitor1.semanticModel.dialogs).length,
    'Should have same number of dialogs'
  );

  assert.equal(
    Object.keys(visitor2.semanticModel.functions).length,
    Object.keys(visitor1.semanticModel.functions).length,
    'Should have same number of functions'
  );

  // Check specific dialog properties
  const dialog1 = visitor1.semanticModel.dialogs.DIA_Test_Exit;
  const dialog2 = visitor2.semanticModel.dialogs.DIA_Test_Exit;

  assert.ok(dialog1, 'Original should have DIA_Test_Exit');
  assert.ok(dialog2, 'Generated should have DIA_Test_Exit');
  assert.equal(dialog1.properties.npc, dialog2.properties.npc);
  assert.equal(dialog1.properties.nr, dialog2.properties.nr);
  assert.equal(dialog1.properties.permanent, dialog2.properties.permanent);
});

test('SemanticCodeGenerator should generate complex dialog with actions', () => {
  const sourceCode = `
instance DIA_Szmyk_Hello(C_INFO)
{
\tnpc\t\t\t= DEV_2130_Szmyk;
\tnr\t\t\t= 1;
\tcondition\t= DIA_Szmyk_Hello_Condition;
\tinformation\t= DIA_Szmyk_Hello_Info;
\tpermanent\t= FALSE;
\timportant\t= TRUE;
};

func int DIA_Szmyk_Hello_Condition()
{
\treturn TRUE;
};

func void DIA_Szmyk_Hello_Info()
{
\tAI_Output(self, other, "DIA_Szmyk_Hello_13_00"); //Welcome message
\tLog_CreateTopic(TOPIC_Quest, LOG_MISSION);
\tB_LogEntry(TOPIC_Quest, "Started the quest");
\tAI_StopProcessInfos(self);
};
`;

  // Parse and analyze
  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  // Generate
  const generator = new SemanticCodeGenerator();
  const result = generator.generateSemanticModel(visitor.semanticModel);

  // Verify structure
  assert.ok(result.includes('instance DIA_Szmyk_Hello(C_INFO)'));
  assert.ok(result.includes('func int DIA_Szmyk_Hello_Condition()'));
  assert.ok(result.includes('func void DIA_Szmyk_Hello_Info()'));

  // Verify actions are generated
  assert.ok(result.includes('AI_Output'));
  assert.ok(result.includes('Log_CreateTopic'));
  assert.ok(result.includes('B_LogEntry'));

  // Parse the generated code to ensure it's valid
  const tree2 = parser.parse(result);
  assert.ok(!tree2.rootNode.hasError, 'Generated code should parse without errors');
});

test('SemanticCodeGenerator should respect includeComments option', () => {
  const generator1 = new SemanticCodeGenerator({ includeComments: true });
  const generator2 = new SemanticCodeGenerator({ includeComments: false });

  const { DialogLine } = require('../dist/semantic-visitor-index');
  const action = new DialogLine('self', 'Hello world', 'TEST_01');

  const result1 = generator1.generateAction(action);
  const result2 = generator2.generateAction(action);

  assert.ok(result1.includes('//Hello world'), 'Should include comment');
  assert.ok(!result2.includes('//'), 'Should not include comment');
});

test('SemanticCodeGenerator should handle empty semantic model', () => {
  const generator = new SemanticCodeGenerator();
  const emptyModel = { dialogs: {}, functions: {} };

  const result = generator.generateSemanticModel(emptyModel);

  assert.equal(typeof result, 'string');
  // Empty model should produce empty or minimal output
  assert.ok(result.length === 0 || result.trim() === '');
});

test('SemanticCodeGenerator should generate all action types', () => {
  const generator = new SemanticCodeGenerator({ includeComments: false });
  const {
    CreateInventoryItems,
    GiveInventoryItems,
    AttackAction,
    SetAttitudeAction,
    ExchangeRoutineAction,
    ChapterTransitionAction,
    LogSetTopicStatus
  } = require('../dist/semantic-visitor-index');

  const tests = [
    {
      action: new CreateInventoryItems('self', 'ItFo_Apple', 5),
      expected: ['CreateInvItems', 'self', 'ItFo_Apple', '5']
    },
    {
      action: new GiveInventoryItems('self', 'other', 'ItFo_Apple', 3),
      expected: ['B_GiveInvItems', 'self', 'other', 'ItFo_Apple', '3']
    },
    {
      action: new AttackAction('self', 'other', 'AR_NONE', 1),
      expected: ['B_Attack', 'self', 'other', 'AR_NONE', '1']
    },
    {
      action: new SetAttitudeAction('self', 'ATT_HOSTILE'),
      expected: ['B_SetAttitude', 'self', 'ATT_HOSTILE']
    },
    {
      action: new ExchangeRoutineAction('self', 'START'),
      expected: ['Npc_ExchangeRoutine', 'self', 'START']
    },
    {
      action: new ChapterTransitionAction(2, 'NEWWORLD_ZEN'),
      expected: ['B_Kapitelwechsel', '2', 'NEWWORLD_ZEN']
    },
    {
      action: new LogSetTopicStatus('TOPIC_Quest', 'LOG_SUCCESS'),
      expected: ['Log_SetTopicStatus', 'TOPIC_Quest', 'LOG_SUCCESS']
    }
  ];

  for (const { action, expected } of tests) {
    const result = generator.generateAction(action);
    assertIncludes(result, expected, `Generated action for ${action.constructor.name}`);
  }
});
