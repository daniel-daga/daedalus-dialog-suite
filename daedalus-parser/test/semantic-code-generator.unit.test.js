const { test } = require('node:test');
const assert = require('node:assert');
const { assertIncludes } = require('./helpers');
const { SemanticCodeGenerator } = require('../dist/codegen/generator');

// ===================================================================
// CONSTRUCTOR TESTS
// ===================================================================

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

// ===================================================================
// DIALOG GENERATION TESTS
// ===================================================================

test('SemanticCodeGenerator should generate dialog instance', () => {
  const generator = new SemanticCodeGenerator();
  const { Dialog } = require('../dist/semantic/semantic-visitor-index');

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

test('SemanticCodeGenerator should generate dialog with functions', () => {
  const generator = new SemanticCodeGenerator({ sectionHeaders: false });
  const { Dialog, DialogFunction, DialogLine } = require('../dist/semantic/semantic-visitor-index');

  const dialog = new Dialog('DIA_Test_Hello', 'C_INFO');
  dialog.properties.npc = 'TEST_NPC';
  dialog.properties.information = 'DIA_Test_Hello_Info';

  const func = new DialogFunction('DIA_Test_Hello_Info', 'void');
  func.actions.push(new DialogLine('self', 'Hello', 'TEST_01'));

  dialog.properties.information = func;

  const model = {
    dialogs: { 'DIA_Test_Hello': dialog },
    functions: { 'DIA_Test_Hello_Info': func }
  };

  const result = generator.generateDialogWithFunctions('DIA_Test_Hello', model);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('instance DIA_Test_Hello(C_INFO)'));
  assert.ok(result.includes('func void DIA_Test_Hello_Info()'));
  assert.ok(result.includes('AI_Output'));
  assert.ok(result.includes('Hello'));
});

// ===================================================================
// FUNCTION GENERATION TESTS
// ===================================================================

test('SemanticCodeGenerator should generate function declaration', () => {
  const generator = new SemanticCodeGenerator();
  const { DialogFunction } = require('../dist/semantic/semantic-visitor-index');

  const func = new DialogFunction('TestFunc', 'int');
  const result = generator.generateFunction(func);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('func int TestFunc()'));
  assert.ok(result.includes('{'));
  assert.ok(result.includes('};'));
});

test('SemanticCodeGenerator should generate default return for INT when uppercaseKeywords enabled', () => {
  const generator = new SemanticCodeGenerator({ uppercaseKeywords: true });
  const { DialogFunction } = require('../dist/semantic/semantic-visitor-index');

  const func = new DialogFunction('DIA_Test_Exit_Condition', 'INT');
  const result = generator.generateFunction(func);

  assert.ok(result.includes('FUNC INT DIA_Test_Exit_Condition()'));
  assert.ok(result.includes('return TRUE;'));
});

// ===================================================================
// ACTION GENERATION TESTS
// ===================================================================

test('SemanticCodeGenerator should generate dialog line action', () => {
  const generator = new SemanticCodeGenerator();
  const { DialogLine } = require('../dist/semantic/semantic-visitor-index');

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
  const { Choice } = require('../dist/semantic/semantic-visitor-index');

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
  const { CreateTopic } = require('../dist/semantic/semantic-visitor-index');

  const action = new CreateTopic('TOPIC_Quest', 'LOG_MISSION');
  const result = generator.generateAction(action);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('Log_CreateTopic'));
  assert.ok(result.includes('TOPIC_Quest'));
  assert.ok(result.includes('LOG_MISSION'));
});

test('SemanticCodeGenerator should generate log entry action', () => {
  const generator = new SemanticCodeGenerator();
  const { LogEntry } = require('../dist/semantic/semantic-visitor-index');

  const action = new LogEntry('TOPIC_Quest', 'Quest started');
  const result = generator.generateAction(action);

  assert.ok(typeof result === 'string');
  assert.ok(result.includes('B_LogEntry'));
  assert.ok(result.includes('TOPIC_Quest'));
  assert.ok(result.includes('Quest started'));
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
  } = require('../dist/semantic/semantic-visitor-index');

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

// ===================================================================
// OPTIONS AND EDGE CASES
// ===================================================================

test('SemanticCodeGenerator should respect includeComments option', () => {
  const generator1 = new SemanticCodeGenerator({ includeComments: true });
  const generator2 = new SemanticCodeGenerator({ includeComments: false });

  const { DialogLine } = require('../dist/semantic/semantic-visitor-index');
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

// ===================================================================
// VALIDATION AND ROBUSTNESS TESTS
// ===================================================================

test('SetVariableAction should generate code even with empty variable name (legacy behavior)', () => {
  const generator = new SemanticCodeGenerator();
  const { SetVariableAction } = require('../dist/semantic/semantic-model');
  const action = new SetVariableAction('', '=', 'LOG_RUNNING');
  const result = generator.generateAction(action);

  // Reverted behavior: it generates exactly what it's given
  assert.equal(result, ' = LOG_RUNNING;');
});

test('CreateInventoryItems should generate code even with missing item (legacy behavior)', () => {
  const generator = new SemanticCodeGenerator();
  const { CreateInventoryItems } = require('../dist/semantic/semantic-model');
  const action = new CreateInventoryItems('self', '', 5);
  const result = generator.generateAction(action);

  assert.equal(result, 'CreateInvItems(self, , 5);');
});
