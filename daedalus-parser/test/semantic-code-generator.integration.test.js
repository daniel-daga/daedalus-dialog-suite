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

test('SemanticCodeGenerator preserves top-level declaration order from source', () => {
  const sourceCode = `
func void Helper_Before()
{
	AI_Output(self, other, "H_01");
};

instance DIA_Order_Test(C_INFO)
{
	npc			= TEST_NPC;
	nr			= 1;
	condition	= DIA_Order_Test_Condition;
	information	= DIA_Order_Test_Info;
	description	= "Order";
};

func int DIA_Order_Test_Condition()
{
	return TRUE;
};

func void DIA_Order_Test_Info()
{
	AI_Output(self, other, "D_01");
};

func void Helper_After()
{
	AI_Output(self, other, "H_02");
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  const helperBeforeIdx = generatedCode.indexOf('func void Helper_Before()');
  const instanceIdx = generatedCode.indexOf('instance DIA_Order_Test(C_INFO)');
  const conditionIdx = generatedCode.indexOf('func int DIA_Order_Test_Condition()');
  const infoIdx = generatedCode.indexOf('func void DIA_Order_Test_Info()');
  const helperAfterIdx = generatedCode.indexOf('func void Helper_After()');

  assert.ok(helperBeforeIdx >= 0, 'Helper_Before should exist');
  assert.ok(instanceIdx >= 0, 'DIA_Order_Test instance should exist');
  assert.ok(conditionIdx >= 0, 'condition function should exist');
  assert.ok(infoIdx >= 0, 'info function should exist');
  assert.ok(helperAfterIdx >= 0, 'Helper_After should exist');

  assert.ok(helperBeforeIdx < instanceIdx, 'Helper_Before should stay before instance');
  assert.ok(instanceIdx < conditionIdx, 'instance should stay before condition');
  assert.ok(conditionIdx < infoIdx, 'condition should stay before info');
  assert.ok(infoIdx < helperAfterIdx, 'Helper_After should stay after dialog functions');
});

test('SemanticCodeGenerator preserves source style metadata (comments, keyword casing, spacing, property order)', () => {
  const sourceCode = `
// ************************************************************
// \t\t\t\t\tEXIT
// ************************************************************
Instance DIA_Style_Test (C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 1;
\tdescription\t= "ENDE";
\tpermanent\t= TRUE;
};

Func int DIA_Style_Test_Condition ()
{
\treturn TRUE;
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const generator = new SemanticCodeGenerator({
    includeComments: true,
    sectionHeaders: true,
    uppercaseKeywords: true,
    preserveSourceStyle: true
  });

  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  assert.ok(generatedCode.includes('// \t\t\t\t\tEXIT'), 'Should preserve original section title comment');
  assert.ok(generatedCode.includes('Instance DIA_Style_Test (C_INFO)'), 'Should preserve instance keyword casing and spacing');
  assert.ok(generatedCode.includes('Func int DIA_Style_Test_Condition ()'), 'Should preserve function keyword casing and spacing');

  const descriptionIdx = generatedCode.indexOf('description');
  const permanentIdx = generatedCode.indexOf('permanent');
  assert.ok(descriptionIdx >= 0 && permanentIdx >= 0, 'Properties should exist');
  assert.ok(descriptionIdx < permanentIdx, 'Should preserve original property order');
});

test('SemanticCodeGenerator should preserve Info_AddChoice expression text arguments', () => {
  const sourceCode = `
instance DIA_Test_Choice(C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 1;
\tcondition\t= DIA_Test_Choice_Condition;
\tinformation\t= DIA_Test_Choice_Info;
\tdescription\t= "Choice";
};

func int DIA_Test_Choice_Condition()
{
\treturn TRUE;
};

func void DIA_Test_Choice_Info()
{
\tInfo_AddChoice(DIA_Test_Choice, B_BuildLearnString("Schmieden lernen", 10), DIA_Test_Choice_Next);
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  assert.ok(
    generatedCode.includes('Info_AddChoice (DIA_Test_Choice, B_BuildLearnString("Schmieden lernen", 10), DIA_Test_Choice_Next);'),
    'Generated code should keep expression argument unquoted'
  );

  const reparsed = parser.parse(generatedCode);
  assert.ok(!reparsed.rootNode.hasError, 'Generated code should parse without syntax errors');
});

test('SemanticCodeGenerator should preserve expression-valued dialog properties', () => {
  const sourceCode = `
instance DIA_Test_PropertyExpr(C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 1;
\tcondition\t= DIA_Test_PropertyExpr_Condition;
\tinformation\t= DIA_Test_PropertyExpr_Info;
\tdescription\t= B_BuildLearnString("Schmieden lernen", 10);
};

func int DIA_Test_PropertyExpr_Condition()
{
\treturn TRUE;
};

func void DIA_Test_PropertyExpr_Info()
{
\tAI_StopProcessInfos(self);
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  assert.ok(
    generatedCode.includes('description\t= B_BuildLearnString("Schmieden lernen", 10);'),
    'Generated code should keep expression-valued property unquoted'
  );

  const reparsed = parser.parse(generatedCode);
  assert.ok(!reparsed.rootNode.hasError, 'Generated code should parse without syntax errors');
});

test('SemanticCodeGenerator should preserve escaped internal quotes in string arguments', () => {
  const sourceCode = `
instance DIA_Test_EscapedQuotes(C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 1;
\tcondition\t= DIA_Test_EscapedQuotes_Condition;
\tinformation\t= DIA_Test_EscapedQuotes_Info;
\tdescription\t= "Escaped";
};

func int DIA_Test_EscapedQuotes_Condition()
{
\treturn TRUE;
};

func void DIA_Test_EscapedQuotes_Info()
{
\tB_LogEntry(TOPIC_Test, "He said \\"hello\\"");
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  assert.ok(
    generatedCode.includes('B_LogEntry (TOPIC_Test, "He said \\"hello\\"");'),
    'Generated code should preserve escaped internal quotes'
  );
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
  assert.ok(/instance\s+DIA_Arog_EXIT/i.test(generatedCode), 'Generated code should contain DIA_Arog_EXIT instance');
  assert.ok(/instance\s+TRIA_ArogAlchemist/i.test(generatedCode), 'Generated code should contain TRIA_ArogAlchemist instance');
  assert.ok(/instance\s+DIA_Arog_Buddler/i.test(generatedCode), 'Generated code should contain DIA_Arog_Buddler instance');
  assert.ok(/func\s+int\s+DIA_Arog_EXIT_Condition/i.test(generatedCode), 'Generated code should contain condition function');
  assert.ok(/func\s+void\s+TRIA_ArogAlchemist_info/i.test(generatedCode), 'Generated code should contain info function');

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
  const ratioMessage
    = `Generated code length should be similar to original (ratio: ${lengthRatio.toFixed(2)}). `
    + `Original: ${normalizedOriginal.length} chars, Generated: ${normalizedGenerated.length} chars`;

  assert.ok(
    lengthRatio > 0.8 && lengthRatio < 1.2,
    ratioMessage
  );
});

// ===================================================================
// FUNCTION CLUSTERING / ORDERING TESTS
// ===================================================================

test('SemanticCodeGenerator clusters choice target functions with their parent dialog', () => {
  const sourceCode = `
instance DIA_Test_Choices(C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 1;
\tcondition\t= DIA_Test_Choices_Condition;
\tinformation\t= DIA_Test_Choices_Info;
\tdescription\t= "Choices";
};

func int DIA_Test_Choices_Condition()
{
\treturn TRUE;
};

func void DIA_Test_Choices_Info()
{
\tAI_Output(other, self, "DIA_Test_Choices_15_00");
\tInfo_AddChoice(DIA_Test_Choices, "Option A", DIA_Test_Choices_A);
\tInfo_AddChoice(DIA_Test_Choices, "Option B", DIA_Test_Choices_B);
};

func void DIA_Test_Choices_A()
{
\tAI_Output(self, other, "DIA_Test_Choices_A_01");
};

func void DIA_Test_Choices_B()
{
\tAI_Output(self, other, "DIA_Test_Choices_B_01");
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  // All functions should exist
  const instanceIdx = generatedCode.indexOf('instance DIA_Test_Choices(C_INFO)');
  const conditionIdx = generatedCode.indexOf('func int DIA_Test_Choices_Condition()');
  const infoIdx = generatedCode.indexOf('func void DIA_Test_Choices_Info()');
  const choiceAIdx = generatedCode.indexOf('func void DIA_Test_Choices_A()');
  const choiceBIdx = generatedCode.indexOf('func void DIA_Test_Choices_B()');

  assert.ok(instanceIdx >= 0, 'instance should exist');
  assert.ok(conditionIdx >= 0, 'condition function should exist');
  assert.ok(infoIdx >= 0, 'info function should exist');
  assert.ok(choiceAIdx >= 0, 'choice A function should exist');
  assert.ok(choiceBIdx >= 0, 'choice B function should exist');

  // Verify ordering: instance < condition < info < choiceA < choiceB
  assert.ok(instanceIdx < conditionIdx, 'instance should come before condition');
  assert.ok(conditionIdx < infoIdx, 'condition should come before info');
  assert.ok(infoIdx < choiceAIdx, 'info should come before choice A');
  assert.ok(choiceAIdx < choiceBIdx, 'choice A should come before choice B');
});

test('SemanticCodeGenerator clusters functions even when source order is scattered', () => {
  // Simulate a model where choice functions were declared far from their dialog
  const sourceCode = `
func void DIA_Test_Scattered_B()
{
\tAI_Output(self, other, "DIA_Test_Scattered_B_01");
};

func void DIA_Test_Scattered_A()
{
\tAI_Output(self, other, "DIA_Test_Scattered_A_01");
};

instance DIA_Test_Scattered(C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 1;
\tcondition\t= DIA_Test_Scattered_Condition;
\tinformation\t= DIA_Test_Scattered_Info;
\tdescription\t= "Scattered";
};

func int DIA_Test_Scattered_Condition()
{
\treturn TRUE;
};

func void DIA_Test_Scattered_Info()
{
\tAI_Output(other, self, "DIA_Test_Scattered_15_00");
\tInfo_AddChoice(DIA_Test_Scattered, "A", DIA_Test_Scattered_A);
\tInfo_AddChoice(DIA_Test_Scattered, "B", DIA_Test_Scattered_B);
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  const instanceIdx = generatedCode.indexOf('instance DIA_Test_Scattered(C_INFO)');
  const conditionIdx = generatedCode.indexOf('func int DIA_Test_Scattered_Condition()');
  const infoIdx = generatedCode.indexOf('func void DIA_Test_Scattered_Info()');
  const choiceAIdx = generatedCode.indexOf('func void DIA_Test_Scattered_A()');
  const choiceBIdx = generatedCode.indexOf('func void DIA_Test_Scattered_B()');

  assert.ok(instanceIdx >= 0, 'instance should exist');

  // All associated functions should follow the dialog instance, clustered together
  assert.ok(instanceIdx < conditionIdx, 'condition should follow its dialog instance');
  assert.ok(conditionIdx < infoIdx, 'info should follow condition');
  assert.ok(infoIdx < choiceAIdx, 'choice A should follow info');
  assert.ok(infoIdx < choiceBIdx, 'choice B should follow info');
});

test('SemanticCodeGenerator keeps non-dialog helper functions in relative position', () => {
  const sourceCode = `
func void Helper_Before()
{
\tAI_Output(self, other, "H_01");
};

instance DIA_Test_Helpers(C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 1;
\tcondition\t= DIA_Test_Helpers_Condition;
\tinformation\t= DIA_Test_Helpers_Info;
\tdescription\t= "Helpers";
};

func int DIA_Test_Helpers_Condition()
{
\treturn TRUE;
};

func void DIA_Test_Helpers_Info()
{
\tAI_Output(other, self, "DIA_Test_Helpers_15_00");
};

func void Helper_After()
{
\tAI_Output(self, other, "H_02");
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  const helperBeforeIdx = generatedCode.indexOf('func void Helper_Before()');
  const instanceIdx = generatedCode.indexOf('instance DIA_Test_Helpers(C_INFO)');
  const helperAfterIdx = generatedCode.indexOf('func void Helper_After()');

  assert.ok(helperBeforeIdx >= 0, 'Helper_Before should exist');
  assert.ok(instanceIdx >= 0, 'instance should exist');
  assert.ok(helperAfterIdx >= 0, 'Helper_After should exist');

  // Helper functions should stay in their relative positions
  assert.ok(helperBeforeIdx < instanceIdx, 'Helper_Before should remain before the dialog');
  assert.ok(instanceIdx < helperAfterIdx, 'Helper_After should remain after the dialog');
});

test('SemanticCodeGenerator clusters multiple dialog instances with their own functions', () => {
  const sourceCode = `
instance DIA_First(C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 1;
\tcondition\t= DIA_First_Condition;
\tinformation\t= DIA_First_Info;
\tdescription\t= "First";
};

func int DIA_First_Condition()
{
\treturn TRUE;
};

func void DIA_First_Info()
{
\tAI_Output(other, self, "DIA_First_01");
\tInfo_AddChoice(DIA_First, "Sub", DIA_First_Sub);
};

func void DIA_First_Sub()
{
\tAI_Output(self, other, "DIA_First_Sub_01");
};

instance DIA_Second(C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 2;
\tcondition\t= DIA_Second_Condition;
\tinformation\t= DIA_Second_Info;
\tdescription\t= "Second";
};

func int DIA_Second_Condition()
{
\treturn TRUE;
};

func void DIA_Second_Info()
{
\tAI_Output(other, self, "DIA_Second_01");
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  const firstIdx = generatedCode.indexOf('instance DIA_First(C_INFO)');
  const firstCondIdx = generatedCode.indexOf('func int DIA_First_Condition()');
  const firstInfoIdx = generatedCode.indexOf('func void DIA_First_Info()');
  const firstSubIdx = generatedCode.indexOf('func void DIA_First_Sub()');
  const secondIdx = generatedCode.indexOf('instance DIA_Second(C_INFO)');
  const secondCondIdx = generatedCode.indexOf('func int DIA_Second_Condition()');
  const secondInfoIdx = generatedCode.indexOf('func void DIA_Second_Info()');

  // First dialog cluster is complete before second dialog starts
  assert.ok(firstIdx < firstCondIdx, 'First instance before its condition');
  assert.ok(firstCondIdx < firstInfoIdx, 'First condition before its info');
  assert.ok(firstInfoIdx < firstSubIdx, 'First info before its choice sub-function');
  assert.ok(firstSubIdx < secondIdx, 'First dialog cluster complete before second dialog');
  assert.ok(secondIdx < secondCondIdx, 'Second instance before its condition');
  assert.ok(secondCondIdx < secondInfoIdx, 'Second condition before its info');
});

// ===================================================================
// LOCAL VARIABLE DECLARATIONS (review finding F4)
// ===================================================================

test('Local var declarations in function bodies are preserved on roundtrip', () => {
  const sourceCode = `
func void DIA_Local_Helper()
{
	var int x;
	x = 5;
	AI_StopProcessInfos(self);
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const func = visitor.semanticModel.functions.DIA_Local_Helper;
  assert.ok(func, 'Function should be in the model');
  assert.equal(func.actions.length, 3, 'Declaration, assignment and call should each be one action');

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  assert.ok(generatedCode.includes('var int x;'), `Generated code should keep the local declaration. Got:\n${generatedCode}`);
  assert.ok(generatedCode.includes('x = 5;'), 'Generated code should keep the assignment');

  const reparsed = parser.parse(generatedCode);
  assert.equal(reparsed.rootNode.hasError, false, 'Generated code should parse cleanly');
});

test('Local var declaration with initializer does not create spurious actions', () => {
  const sourceCode = `
func void DIA_Local_Init()
{
	var int x = Hlp_GetInstanceID(self);
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const func = visitor.semanticModel.functions.DIA_Local_Init;
  assert.ok(func, 'Function should be in the model');
  assert.equal(func.actions.length, 1, 'Initializer call must not become a separate action');
  assert.equal(func.actions[0].constructor.name, 'Action', 'Declaration should be preserved as raw Action');
  assert.equal(func.actions[0].action, 'var int x = Hlp_GetInstanceID(self);');
});

test('Local var declaration inside an if block is preserved on roundtrip', () => {
  const sourceCode = `
func void DIA_Local_Nested()
{
	if (Kapitel == 2)
	{
		var int x;
		B_GivePlayerXP(100);
	};
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const func = visitor.semanticModel.functions.DIA_Local_Nested;
  assert.ok(func, 'Function should be in the model');

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  assert.ok(generatedCode.includes('var int x;'), `Generated code should keep the nested local declaration. Got:\n${generatedCode}`);
  assert.match(generatedCode, /B_GivePlayerXP\s*\(100\)/, 'Generated code should keep the sibling call');
});

// ===================================================================
// FUNCTION PARAMETERS (review finding F5)
// ===================================================================

test('Function parameters are modeled and preserved on roundtrip', () => {
  const sourceCode = `
func void B_Say(var C_NPC slf, var string msg)
{
	AI_StopProcessInfos(self);
};

func int CalcDamage(VAR INT base)
{
	return TRUE;
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const bSay = visitor.semanticModel.functions.B_Say;
  assert.ok(bSay, 'B_Say should be in the model');
  assert.deepEqual(bSay.parameters, [
    { keyword: 'var', type: 'C_NPC', name: 'slf' },
    { keyword: 'var', type: 'string', name: 'msg' }
  ], 'Parameters should be modeled with source casing');

  const calcDamage = visitor.semanticModel.functions.CalcDamage;
  assert.ok(calcDamage, 'CalcDamage should be in the model');
  assert.deepEqual(calcDamage.parameters, [
    { keyword: 'VAR', type: 'INT', name: 'base' }
  ], 'Uppercase keyword and type casing should be preserved');

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor.semanticModel);

  assert.ok(
    generatedCode.includes('func void B_Say(var C_NPC slf, var string msg)'),
    `Generated code should keep the parameter list. Got:\n${generatedCode}`
  );
  assert.ok(
    generatedCode.includes('func int CalcDamage(VAR INT base)'),
    'Generated code should keep parameter casing'
  );

  const reparsed = parser.parse(generatedCode);
  assert.equal(reparsed.rootNode.hasError, false, 'Generated code should parse cleanly');
});
