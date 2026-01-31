const test = require('node:test');
const assert = require('node:assert');
const Parser = require('tree-sitter');
const Daedalus = require('../bindings/node');
const {
  SemanticModelBuilderVisitor,
  SemanticCodeGenerator,
  NpcKnowsInfoCondition,
  Condition,
  VariableCondition
} = require('../dist/semantic/semantic-visitor-index');

// Test data: Dialog with Npc_KnowsInfo condition
const dialogWithNpcKnowsInfo = `
instance DIA_Farim_FirstEXIT(C_INFO)
{
	npc			= SLD_99003_Farim;
	nr			= 999;
	condition	= DIA_Farim_FirstEXIT_Condition;
	information	= DIA_Farim_FirstEXIT_Info;
	permanent	= FALSE;
	description = "Leave";
};

func int DIA_Farim_FirstEXIT_Condition()
{
	if (Npc_KnowsInfo(other, DIA_Farim_Hallo))
	{
		return TRUE;
	};
};

func void DIA_Farim_FirstEXIT_Info()
{
	AI_StopProcessInfos(self);
};
`;

// Test data: Dialog with simple condition
const dialogWithSimpleCondition = `
instance DIA_Test_Simple(C_INFO)
{
	npc			= TestNpc;
	nr			= 1;
	condition	= DIA_Test_Simple_Condition;
	information	= DIA_Test_Simple_Info;
	permanent	= true;
	description = "Test";
};

func int DIA_Test_Simple_Condition()
{
	return true;
};

func void DIA_Test_Simple_Info()
{
	AI_Output(self, other, "TEST_01");
};
`;

// Helper: Parse and build semantic model
function parseAndBuildModel(source) {
  const parser = new Parser();
  parser.setLanguage(Daedalus);
  const tree = parser.parse(source);

  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  return visitor.semanticModel;
}

test('Should parse Npc_KnowsInfo condition', () => {
  const model = parseAndBuildModel(dialogWithNpcKnowsInfo);

  // Check dialog exists
  assert.ok(model.dialogs['DIA_Farim_FirstEXIT'], 'Dialog should exist');

  const dialog = model.dialogs['DIA_Farim_FirstEXIT'];

  // Check condition function exists
  assert.ok(dialog.properties.condition, 'Dialog should have condition function');
  const conditionFunc = dialog.properties.condition;
  assert.ok(conditionFunc.conditions, 'Condition function should have conditions array');
  assert.strictEqual(conditionFunc.conditions.length, 1, 'Condition function should have 1 condition');

  // Check condition type
  const condition = conditionFunc.conditions[0];
  assert.ok(condition instanceof NpcKnowsInfoCondition, 'Condition should be NpcKnowsInfoCondition');
  assert.strictEqual(condition.npc, 'other', 'NPC should be "other"');
  assert.strictEqual(condition.dialogRef, 'DIA_Farim_Hallo', 'Dialog reference should be correct');
});

test('Should generate Npc_KnowsInfo condition code', () => {
  const condition = new NpcKnowsInfoCondition('other', 'DIA_Farim_Hallo');
  const code = condition.generateCode({});

  assert.strictEqual(code, 'Npc_KnowsInfo(other, DIA_Farim_Hallo)', 'Generated code should match');
});

test('Should round-trip dialog with Npc_KnowsInfo condition', () => {
  const model = parseAndBuildModel(dialogWithNpcKnowsInfo);
  const generator = new SemanticCodeGenerator();
  const generatedCode = generator.generateSemanticModel(model);

  // Verify generated code contains the condition
  assert.ok(generatedCode.includes('Npc_KnowsInfo(other, DIA_Farim_Hallo)'),
           'Generated code should contain Npc_KnowsInfo call');
  assert.ok(generatedCode.includes('DIA_Farim_FirstEXIT_Condition'),
           'Generated code should contain condition function');
  assert.ok(generatedCode.includes('return TRUE'),
           'Generated code should return TRUE');

  // Parse generated code and verify it matches
  const model2 = parseAndBuildModel(generatedCode);
  const dialog2 = model2.dialogs['DIA_Farim_FirstEXIT'];

  assert.ok(dialog2, 'Re-parsed dialog should exist');
  const conditionFunc2 = dialog2.properties.condition;
  assert.strictEqual(conditionFunc2.conditions.length, 1, 'Re-parsed condition function should have 1 condition');
  assert.ok(conditionFunc2.conditions[0] instanceof NpcKnowsInfoCondition,
           'Re-parsed condition should be NpcKnowsInfoCondition');
});

test('Should handle dialog without conditions', () => {
  const model = parseAndBuildModel(dialogWithSimpleCondition);
  const dialog = model.dialogs['DIA_Test_Simple'];

  // The condition function just returns true without any semantic conditions
  assert.ok(dialog, 'Dialog should exist');
  const conditionFunc = dialog.properties.condition;
  assert.strictEqual(conditionFunc.conditions.length, 0,
                     'Condition function with simple return should have no semantic conditions');
});

test('Should display condition correctly', () => {
  const condition = new NpcKnowsInfoCondition('other', 'DIA_Farim_Hallo');
  const display = condition.toDisplayString();

  assert.strictEqual(display, '[NpcKnowsInfo: other knows DIA_Farim_Hallo]',
                     'Display string should be formatted correctly');
});

test('Generic Condition should work for custom expressions', () => {
  const condition = new Condition('hero.attribute[ATR_HITPOINTS] > 50');

  assert.strictEqual(condition.condition, 'hero.attribute[ATR_HITPOINTS] > 50',
                     'Condition should store expression');
  assert.strictEqual(condition.generateCode({}), 'hero.attribute[ATR_HITPOINTS] > 50',
                     'Should generate correct code');
  assert.strictEqual(condition.getTypeName(), 'Condition',
                     'Type name should be Condition');
});

test('Should link condition function to dialog via properties', () => {
  const model = parseAndBuildModel(dialogWithNpcKnowsInfo);
  const dialog = model.dialogs['DIA_Farim_FirstEXIT'];
  const conditionFunc = model.functions['DIA_Farim_FirstEXIT_Condition'];

  // Check that condition property references the function
  assert.ok(dialog.properties.condition, 'Dialog should have condition property');
  assert.strictEqual(dialog.properties.condition.name, 'DIA_Farim_FirstEXIT_Condition',
                     'Condition property should reference correct function');

  // Check the function exists
  assert.ok(conditionFunc, 'Condition function should exist in model');
  assert.strictEqual(conditionFunc.returnType, 'int', 'Condition function should return int');
});

test('Should generate condition function with if statement', () => {
  const model = parseAndBuildModel(dialogWithNpcKnowsInfo);
  const generator = new SemanticCodeGenerator();
  const generatedCode = generator.generateSemanticModel(model);

  // Check structure of generated condition function
  assert.ok(generatedCode.includes('func int DIA_Farim_FirstEXIT_Condition()'),
           'Should generate function declaration');
  assert.ok(generatedCode.includes('if (Npc_KnowsInfo(other, DIA_Farim_Hallo))'),
           'Should generate if statement with condition');
  assert.ok(generatedCode.includes('return TRUE'),
           'Should return TRUE in if block');
});

test('Multiple conditions should be handled', () => {
  const dialogWithMultipleConditions = `
instance DIA_Test_Multi(C_INFO)
{
	npc			= TestNpc;
	nr			= 1;
	condition	= DIA_Test_Multi_Condition;
	information	= DIA_Test_Multi_Info;
	permanent	= true;
	description = "Test";
};

func int DIA_Test_Multi_Condition()
{
	if (Npc_KnowsInfo(other, DIA_First))
	{
		if (Npc_KnowsInfo(other, DIA_Second))
		{
			return TRUE;
		};
	};
};

func void DIA_Test_Multi_Info()
{
	AI_Output(self, other, "TEST_01");
};
`;

  const model = parseAndBuildModel(dialogWithMultipleConditions);
  const dialog = model.dialogs['DIA_Test_Multi'];
  const conditionFunc = dialog.properties.condition;

  assert.strictEqual(conditionFunc.conditions.length, 2, 'Should parse 2 conditions');
  assert.ok(conditionFunc.conditions[0] instanceof NpcKnowsInfoCondition, 'First should be NpcKnowsInfo');
  assert.ok(conditionFunc.conditions[1] instanceof NpcKnowsInfoCondition, 'Second should be NpcKnowsInfo');
  assert.strictEqual(conditionFunc.conditions[0].dialogRef, 'DIA_First', 'First ref should be DIA_First');
  assert.strictEqual(conditionFunc.conditions[1].dialogRef, 'DIA_Second', 'Second ref should be DIA_Second');
});

test('Should parse variable conditions with negation', () => {
  const dialogWithVariables = `
instance DIA_Test_Variables(C_INFO)
{
	npc			= TestNpc;
	nr			= 1;
	condition	= DIA_Test_Variables_Condition;
	information	= DIA_Test_Variables_Info;
	permanent	= true;
	description = "Test";
};

func int DIA_Test_Variables_Condition()
{
	if (Npc_KnowsInfo(other, DIA_AlchemistWald_Amnesie)
	&& Npc_KnowsInfo(other, DIA_Arog_Buddler)
	&& !EntscheidungBuddlerMapTaken
	&& EntscheidungVergessenTaken)
	{
		return TRUE;
	};
};

func void DIA_Test_Variables_Info()
{
	AI_Output(self, other, "TEST_01");
};
`;

  const model = parseAndBuildModel(dialogWithVariables);
  const dialog = model.dialogs['DIA_Test_Variables'];
  const conditionFunc = dialog.properties.condition;

  assert.strictEqual(conditionFunc.conditions.length, 4, 'Should parse 4 conditions');

  // First two should be NpcKnowsInfo
  assert.ok(conditionFunc.conditions[0] instanceof NpcKnowsInfoCondition, 'First should be NpcKnowsInfo');
  assert.ok(conditionFunc.conditions[1] instanceof NpcKnowsInfoCondition, 'Second should be NpcKnowsInfo');

  // Third should be negated variable
  assert.ok(conditionFunc.conditions[2] instanceof VariableCondition, 'Third should be VariableCondition');
  assert.strictEqual(conditionFunc.conditions[2].variableName, 'EntscheidungBuddlerMapTaken', 'Variable name should match');
  assert.strictEqual(conditionFunc.conditions[2].negated, true, 'Should be negated');

  // Fourth should be plain variable
  assert.ok(conditionFunc.conditions[3] instanceof VariableCondition, 'Fourth should be VariableCondition');
  assert.strictEqual(conditionFunc.conditions[3].variableName, 'EntscheidungVergessenTaken', 'Variable name should match');
  assert.strictEqual(conditionFunc.conditions[3].negated, false, 'Should not be negated');
});

test('Should generate code for variable conditions', () => {
  const plainVar = new VariableCondition('myVariable', false);
  const negatedVar = new VariableCondition('myVariable', true);

  assert.strictEqual(plainVar.generateCode({}), 'myVariable', 'Plain variable should generate correctly');
  assert.strictEqual(negatedVar.generateCode({}), '!myVariable', 'Negated variable should generate correctly');
});

test('Should display variable conditions correctly', () => {
  const plainVar = new VariableCondition('EntscheidungVergessenTaken', false);
  const negatedVar = new VariableCondition('EntscheidungBuddlerMapTaken', true);

  assert.strictEqual(plainVar.toDisplayString(), '[Variable: EntscheidungVergessenTaken]',
                     'Plain variable display should be correct');
  assert.strictEqual(negatedVar.toDisplayString(), '[Not: EntscheidungBuddlerMapTaken]',
                     'Negated variable display should be correct');
});

test('Should round-trip dialog with variable conditions', () => {
  const dialogWithVariables = `
instance DIA_Test_Roundtrip(C_INFO)
{
	npc			= TestNpc;
	nr			= 1;
	condition	= DIA_Test_Roundtrip_Condition;
	information	= DIA_Test_Roundtrip_Info;
	permanent	= true;
	description = "Test";
};

func int DIA_Test_Roundtrip_Condition()
{
	if (Npc_KnowsInfo(other, DIA_Test)
	&& !someFlag
	&& anotherFlag)
	{
		return TRUE;
	};
};

func void DIA_Test_Roundtrip_Info()
{
	AI_Output(self, other, "TEST_01");
};
`;

  const model = parseAndBuildModel(dialogWithVariables);
  const generator = new SemanticCodeGenerator();
  const generatedCode = generator.generateSemanticModel(model);

  // Verify generated code contains the conditions
  assert.ok(generatedCode.includes('Npc_KnowsInfo(other, DIA_Test)'),
           'Generated code should contain Npc_KnowsInfo');
  assert.ok(generatedCode.includes('!someFlag'),
           'Generated code should contain negated variable');
  assert.ok(generatedCode.includes('anotherFlag'),
           'Generated code should contain plain variable');

  // Parse generated code and verify it matches
  const model2 = parseAndBuildModel(generatedCode);
  const dialog2 = model2.dialogs['DIA_Test_Roundtrip'];
  const conditionFunc2 = dialog2.properties.condition;

  assert.ok(dialog2, 'Re-parsed dialog should exist');
  assert.strictEqual(conditionFunc2.conditions.length, 3, 'Re-parsed condition function should have 3 conditions');
  assert.ok(conditionFunc2.conditions[0] instanceof NpcKnowsInfoCondition, 'First should be NpcKnowsInfo');
  assert.ok(conditionFunc2.conditions[1] instanceof VariableCondition, 'Second should be VariableCondition');
  assert.strictEqual(conditionFunc2.conditions[1].negated, true, 'Second should be negated');
  assert.ok(conditionFunc2.conditions[2] instanceof VariableCondition, 'Third should be VariableCondition');
  assert.strictEqual(conditionFunc2.conditions[2].negated, false, 'Third should not be negated');
});
