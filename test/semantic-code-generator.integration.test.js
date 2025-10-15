const { test } = require('node:test');
const assert = require('node:assert');
const { createParser } = require('./helpers');
const { SemanticCodeGenerator } = require('../dist/semantic-code-generator');
const { SemanticModelBuilderVisitor } = require('../dist/semantic-visitor-index');

// Initialize parser
const parser = createParser();

// ===================================================================
// ROUND-TRIP TESTS
// ===================================================================

test('SemanticCodeGenerator round-trip: parse -> generate -> parse', () => {
  const sourceCode = `
instance DIA_Test_Exit(C_INFO)
{
	npc			= TEST_NPC;
	nr			= 999;
	condition	= DIA_Test_Exit_Condition;
	information	= DIA_Test_Exit_Info;
	permanent	= TRUE;
	description	= DIALOG_ENDE;
};

func int DIA_Test_Exit_Condition()
{
	return TRUE;
};

func void DIA_Test_Exit_Info()
{
	AI_StopProcessInfos(self);
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

// ===================================================================
// END-TO-END TESTS
// ===================================================================

test('SemanticCodeGenerator should generate complex dialog with actions', () => {
  const sourceCode = `
instance DIA_Szmyk_Hello(C_INFO)
{
	npc			= DEV_2130_Szmyk;
	nr			= 1;
	condition	= DIA_Szmyk_Hello_Condition;
	information	= DIA_Szmyk_Hello_Info;
	permanent	= FALSE;
	important	= TRUE;
};

func int DIA_Szmyk_Hello_Condition()
{
	return TRUE;
};

func void DIA_Szmyk_Hello_Info()
{
	AI_Output(self, other, "DIA_Szmyk_Hello_13_00"); //Welcome message
	Log_CreateTopic(TOPIC_Quest, LOG_MISSION);
	B_LogEntry(TOPIC_Quest, "Started the quest");
	AI_StopProcessInfos(self);
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
