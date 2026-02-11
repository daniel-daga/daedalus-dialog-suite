const test = require('node:test');
const assert = require('node:assert');
const Parser = require('tree-sitter');
const Daedalus = require('../bindings/node');
const {
  SemanticModelBuilderVisitor,
  SemanticCodeGenerator,
  VariableCondition
} = require('../dist/semantic/semantic-visitor-index');

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

test('Should parse binary expression conditions', () => {
  const dialogWithComparison = `
instance DIA_Test_Binary(C_INFO)
{
	npc			= TestNpc;
	nr			= 1;
	condition	= DIA_Test_Binary_Condition;
	information	= DIA_Test_Binary_Info;
	description = "Test";
};

func int DIA_Test_Binary_Condition()
{
	if (MIS_MyQuest == LOG_RUNNING)
	{
		return TRUE;
	};
};

func void DIA_Test_Binary_Info()
{
	AI_Output(self, other, "TEST_01");
};
`;

  const model = parseAndBuildModel(dialogWithComparison);
  const dialog = model.dialogs['DIA_Test_Binary'];
  const conditionFunc = dialog.properties.condition;

  assert.strictEqual(conditionFunc.conditions.length, 1, 'Should parse 1 condition');
  const condition = conditionFunc.conditions[0];

  assert.ok(condition instanceof VariableCondition, 'Should be VariableCondition');
  assert.strictEqual(condition.variableName, 'MIS_MyQuest');
  assert.strictEqual(condition.operator, '==');
  assert.strictEqual(condition.value, 'LOG_RUNNING');
});

test('Should parse binary expression with number', () => {
  const source = `
instance DIA_Test_Number(C_INFO)
{
	npc			= TestNpc;
	condition	= DIA_Test_Number_Condition;
	information	= DIA_Test_Number_Info;
    description = "Test";
};

func int DIA_Test_Number_Condition()
{
	if (MyVar >= 10)
	{
		return TRUE;
	};
};

func void DIA_Test_Number_Info() {};
`;

  const model = parseAndBuildModel(source);
  const condition = model.dialogs['DIA_Test_Number'].properties.condition.conditions[0];

  assert.strictEqual(condition.variableName, 'MyVar');
  assert.strictEqual(condition.operator, '>=');
  assert.strictEqual(condition.value, 10);
});

test('Should parse reversed binary expression with identifier on right', () => {
  const source = `
instance DIA_Test_Reversed(C_INFO)
{
	npc			= TestNpc;
	condition	= DIA_Test_Reversed_Condition;
	information	= DIA_Test_Reversed_Info;
    description = "Test";
};

func int DIA_Test_Reversed_Condition()
{
	if (10 <= MyVar)
	{
		return TRUE;
	};
};

func void DIA_Test_Reversed_Info() {};
`;

  const model = parseAndBuildModel(source);
  const condition = model.dialogs['DIA_Test_Reversed'].properties.condition.conditions[0];

  assert.strictEqual(condition.variableName, 'MyVar');
  assert.strictEqual(condition.operator, '>=');
  assert.strictEqual(condition.value, 10);
});

test('Should parse reversed string comparison with identifier on right', () => {
  const source = `
instance DIA_Test_Reversed_String(C_INFO)
{
	npc			= TestNpc;
	condition	= DIA_Test_Reversed_String_Condition;
	information	= DIA_Test_Reversed_String_Info;
    description = "Test";
};

func int DIA_Test_Reversed_String_Condition()
{
	if ("LOG_RUNNING" == MIS_MyQuest)
	{
		return TRUE;
	};
};

func void DIA_Test_Reversed_String_Info() {};
`;

  const model = parseAndBuildModel(source);
  const condition = model.dialogs['DIA_Test_Reversed_String'].properties.condition.conditions[0];

  assert.strictEqual(condition.variableName, 'MIS_MyQuest');
  assert.strictEqual(condition.operator, '==');
  assert.strictEqual(condition.value, 'LOG_RUNNING');
});

test('Should generate code for binary conditions', () => {
    const condition = new VariableCondition('MIS_Quest', false, '==', 'LOG_SUCCESS');
    const code = condition.generateCode({});
    assert.strictEqual(code, 'MIS_Quest == LOG_SUCCESS');
});

test('Should display binary conditions correctly', () => {
    const condition = new VariableCondition('MIS_Quest', false, '==', 'LOG_SUCCESS');
    const display = condition.toDisplayString();
    assert.strictEqual(display, '[Variable: MIS_Quest == LOG_SUCCESS]');
});
