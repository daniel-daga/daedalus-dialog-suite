const { test } = require('node:test');
const assert = require('node:assert');
const { createParser } = require('./helpers');
const { SemanticCodeGenerator } = require('../dist/codegen/generator');
const { SemanticModelBuilderVisitor } = require('../dist/semantic/semantic-visitor-index');

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

test('SemanticCodeGenerator round-trip: DIA_Arog_SLD_99005.d from examples', () => {
  const fs = require('fs');
  const path = require('path');

  // Read the actual example file
  const filePath = path.join(__dirname, '..', 'examples', 'DIA_Arog_SLD_99005.d');
  const sourceCode = fs.readFileSync(filePath, 'utf-8');

  // Parse original
  const tree1 = parser.parse(sourceCode);
  assert.ok(!tree1.rootNode.hasError, 'Original file should parse without errors');

  const visitor1 = new SemanticModelBuilderVisitor();
  visitor1.pass1_createObjects(tree1.rootNode);
  visitor1.pass2_analyzeAndLink(tree1.rootNode);

  // Generate code from semantic model
  const generator = new SemanticCodeGenerator({
    indentSize: 1,
    indentChar: '\t',
    includeComments: false,
    sectionHeaders: false,
    uppercaseKeywords: false
  });
  const generatedCode = generator.generateSemanticModel(visitor1.semanticModel);

  // Parse generated code
  const tree2 = parser.parse(generatedCode);
  assert.ok(!tree2.rootNode.hasError, 'Generated code should parse without errors');

  const visitor2 = new SemanticModelBuilderVisitor();
  visitor2.pass1_createObjects(tree2.rootNode);
  visitor2.pass2_analyzeAndLink(tree2.rootNode);

  // Compare semantic models - should have same structure
  const originalDialogs = Object.keys(visitor1.semanticModel.dialogs).sort();
  const generatedDialogs = Object.keys(visitor2.semanticModel.dialogs).sort();

  assert.deepEqual(
    generatedDialogs,
    originalDialogs,
    'Generated code should have same dialog instances as original'
  );

  const originalFunctions = Object.keys(visitor1.semanticModel.functions).sort();
  const generatedFunctions = Object.keys(visitor2.semanticModel.functions).sort();

  assert.deepEqual(
    generatedFunctions,
    originalFunctions,
    'Generated code should have same functions as original'
  );

  // Verify some key dialogs are present
  assert.ok(visitor2.semanticModel.dialogs.DIA_Arog_EXIT, 'Should have DIA_Arog_EXIT dialog');
  assert.ok(visitor2.semanticModel.dialogs.TRIA_ArogAlchemist, 'Should have TRIA_ArogAlchemist dialog');
  assert.ok(visitor2.semanticModel.dialogs.DIA_Arog_Buddler, 'Should have DIA_Arog_Buddler dialog');

  // Check that dialog properties are preserved
  const dialog1 = visitor1.semanticModel.dialogs.DIA_Arog_EXIT;
  const dialog2 = visitor2.semanticModel.dialogs.DIA_Arog_EXIT;

  assert.equal(dialog1.properties.npc, dialog2.properties.npc, 'NPC should match');
  assert.equal(dialog1.properties.nr, dialog2.properties.nr, 'Dialog number should match');
  assert.equal(dialog1.properties.description, dialog2.properties.description, 'Description should match');
  assert.equal(dialog1.properties.permanent, dialog2.properties.permanent, 'Permanent flag should match');

  // Check actions are preserved in TRIA_ArogAlchemist_info function
  const func1 = visitor1.semanticModel.functions.TRIA_ArogAlchemist_info;
  const func2 = visitor2.semanticModel.functions.TRIA_ArogAlchemist_info;

  assert.ok(func1, 'Original should have TRIA_ArogAlchemist_info function');
  assert.ok(func2, 'Generated should have TRIA_ArogAlchemist_info function');

  // Count DialogLine actions (AI_Output calls)
  const dialogLines1 = func1.actions.filter(a => a.type === 'DialogLine').length;
  const dialogLines2 = func2.actions.filter(a => a.type === 'DialogLine').length;
  assert.equal(dialogLines2, dialogLines1, 'Should preserve same number of AI_Output calls');

  // Count Log actions
  const logActions1 = func1.actions.filter(a => a.type === 'CreateTopic' || a.type === 'LogSetTopicStatus' || a.type === 'LogEntry').length;
  const logActions2 = func2.actions.filter(a => a.type === 'CreateTopic' || a.type === 'LogSetTopicStatus' || a.type === 'LogEntry').length;
  assert.equal(logActions2, logActions1, 'Should preserve same number of log-related actions');

  // Verify the generated code contains key structural elements from original
  // (Comments and exact whitespace may differ, but code structure should be present)
  assert.ok(generatedCode.includes('instance DIA_Arog_EXIT'), 'Generated code should contain DIA_Arog_EXIT instance');
  assert.ok(generatedCode.includes('instance TRIA_ArogAlchemist'), 'Generated code should contain TRIA_ArogAlchemist instance');
  assert.ok(generatedCode.includes('instance DIA_Arog_Buddler'), 'Generated code should contain DIA_Arog_Buddler instance');
  assert.ok(generatedCode.includes('func int DIA_Arog_EXIT_Condition'), 'Generated code should contain condition function');
  assert.ok(generatedCode.includes('func void TRIA_ArogAlchemist_info'), 'Generated code should contain info function');

  // Helper to check with flexible whitespace
  const containsFlexible = (code, pattern) => {
    const normalized = pattern.replace(/\s+/g, '\\s+');
    const regex = new RegExp(normalized);
    return regex.test(code);
  };

  // Verify specific dialog content is preserved (with flexible whitespace)
  assert.ok(containsFlexible(generatedCode, 'npc = SLD_99005_Arog'), 'Generated code should preserve NPC assignment');
  assert.ok(containsFlexible(generatedCode, 'description = "ENDE"'), 'Generated code should preserve description');
  assert.ok(generatedCode.includes('AI_StopProcessInfos'), 'Generated code should preserve AI_StopProcessInfos calls');
  assert.ok(generatedCode.includes('Log_CreateTopic'), 'Generated code should preserve Log_CreateTopic calls');
  assert.ok(generatedCode.includes('B_LogEntry'), 'Generated code should preserve B_LogEntry calls');
  assert.ok(generatedCode.includes('Info_AddChoice'), 'Generated code should preserve Info_AddChoice calls');
  assert.ok(generatedCode.includes('CreateInvItems'), 'Generated code should preserve CreateInvItems calls');
  assert.ok(generatedCode.includes('B_GiveInvItems'), 'Generated code should preserve B_GiveInvItems calls');
  assert.ok(generatedCode.includes('Npc_ExchangeRoutine'), 'Generated code should preserve Npc_ExchangeRoutine calls');

  // Normalize whitespace for comparison (remove comments, collapse whitespace)
  const normalizeCode = (code) => {
    return code
      // Remove single-line comments
      .replace(/\/\/[^\n]*/g, '')
      // Remove multi-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  };

  const normalizedOriginal = normalizeCode(sourceCode);
  const normalizedGenerated = normalizeCode(generatedCode);

  // The normalized code should be very similar (allowing for minor formatting differences)
  // Check that they're roughly the same length (within 20% to account for formatting)
  const lengthRatio = normalizedGenerated.length / normalizedOriginal.length;
  assert.ok(
    lengthRatio > 0.8 && lengthRatio < 1.2,
    `Generated code length should be similar to original (ratio: ${lengthRatio.toFixed(2)}). Original: ${normalizedOriginal.length} chars, Generated: ${normalizedGenerated.length} chars`
  );
});
