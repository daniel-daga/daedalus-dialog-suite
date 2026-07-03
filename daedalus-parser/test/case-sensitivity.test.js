const { test } = require('node:test');
const assert = require('node:assert');
const { createParser } = require('./helpers');
const { SemanticModelBuilderVisitor, parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');
const { SemanticCodeGenerator } = require('../dist/codegen/generator');

const parser = createParser();

test('SemanticModelBuilderVisitor should handle case-insensitive function lookups', () => {
  const sourceCode = `
func void MyFunc() {};

instance Dia (C_Info) {
    information = myfunc;
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const dialog = visitor.semanticModel.dialogs.Dia;
  assert.ok(dialog, 'Dialog should exist');

  // The 'information' property should be linked to the function object, not just the string name
  const infoFunc = dialog.properties.information;

  // If it's a string, it means linking failed
  if (typeof infoFunc === 'string') {
    assert.fail(`Linking failed: Expected function object but got string "${infoFunc}"`);
  }

  assert.strictEqual(typeof infoFunc, 'object', 'Information property should be an object (linked function)');
  assert.strictEqual(infoFunc.name, 'MyFunc', 'Function name should match definition');
});

test('condition function matching should be case-insensitive', () => {
  const sourceCode = `
instance DIA_Test(C_Info)
{
    condition = dia_test_condition;
};

func int DIA_Test_Condition()
{
    if (Npc_KnowsInfo(other, DIA_Test))
    {
        return TRUE;
    };
};
`;

  const tree = parser.parse(sourceCode);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const func = visitor.semanticModel.functions.DIA_Test_Condition;
  assert.ok(func, 'Condition function should exist');
  assert.ok(func.conditions.length > 0, 'Condition function should be parsed as conditions, not raw actions');
  assert.strictEqual(func.actions.length, 0, 'Condition function should not be treated as non-condition due to case mismatch');
});

test('action dispatch is case-insensitive: lowercase ai_output parses as DialogLine', () => {
  const source = `
  func void DIA_Test_Info()
  {
    ai_output(other, self, "DIA_Test_01");
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;
  assert.ok(func, 'Function should be parsed');

  const dialogLine = func.actions.find((a) => a.constructor.name === 'DialogLine');
  assert.ok(dialogLine, 'lowercase ai_output should still be dispatched to the DialogLine parser');
  assert.strictEqual(dialogLine.listener, 'self', 'Listener argument should be preserved');
});

test('action dispatch is case-insensitive: mixed-case Info_AddChoice parses as Choice', () => {
  const source = `
  func void DIA_Test_Info()
  {
    INFO_ADDCHOICE(DIA_Test, "Continue", DIA_Test_Next);
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;
  const choice = func.actions.find((a) => a.constructor.name === 'Choice');
  assert.ok(choice, 'mixed-case Info_AddChoice should be dispatched to the Choice parser');
});

test('condition dispatch is case-insensitive: lowercase npc_knowsinfo parses as NpcKnowsInfoCondition', () => {
  const source = `
  instance DIA_Test(C_Info)
  {
    condition = DIA_Test_Condition;
  };

  func int DIA_Test_Condition()
  {
    if (npc_knowsinfo(other, DIA_Test))
    {
      return TRUE;
    };
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Condition;
  assert.ok(func, 'Condition function should exist');

  const cond = func.conditions.find((c) => c.constructor.name === 'NpcKnowsInfoCondition');
  assert.ok(cond, 'lowercase npc_knowsinfo should be dispatched to the NpcKnowsInfo condition parser');
});

// ---------------------------------------------------------------------------
// M1–M5 + PF4: case-insensitive references and clustering (fix-01 step 6)
// ---------------------------------------------------------------------------

// M5: b_beklauen must map to the B_Beklauen behavior and roundtrip verbatim,
// not be rewritten as C_Beklauen (0, 0).
test('lowercase b_beklauen with args roundtrips byte-identically (M5)', () => {
  const source = 'func void DIA_Steal()\n{\n\tb_beklauen (10, 20);\n};\n';
  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Steal;
  const action = func.actions[0];
  assert.equal(action.type, 'PickpocketAction');
  assert.equal(action.pickpocketMode, 'B_Beklauen', 'dispatch by lowercase key selects B_Beklauen');
  assert.equal(action.sourceFunctionName, 'b_beklauen', 'source casing is preserved');

  const generated = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false }).generateFunction(func);
  assert.ok(generated.includes('b_beklauen (10, 20);'), `should emit source-cased call verbatim, got:\n${generated}`);
  assert.ok(!generated.includes('C_Beklauen'), 'must not rewrite b_beklauen as C_Beklauen');
});

// M3: generateDialogWithFunctions must include a case-drifted choice target,
// otherwise the editor omits that function from the emitted output entirely.
test('generateDialogWithFunctions includes a case-drifted choice target (M3)', () => {
  const source = `
instance DIA_Test(C_INFO)
{
    npc = Some_NPC;
    nr = 1;
    information = DIA_Test_Info;
};

func void DIA_Test_Info()
{
    Info_AddChoice (DIA_Test, "Continue", dia_test_branch);
};

func void DIA_Test_Branch()
{
    AI_Output (self, other, "DIA_Test_Branch_00");
};
`;

  const model = parseSemanticModel(source);
  const generated = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false })
    .generateDialogWithFunctions('DIA_Test', model);

  assert.ok(
    generated.includes('func void DIA_Test_Branch()'),
    `case-drifted choice target must be emitted, got:\n${generated}`
  );
});

// M4 + PF4: a function owned by no dialog must resolve correctly (and not be
// mis-attributed) even amid many dialogs; the miss is cached but stays correct.
test('findDialogForFunction resolves case-insensitively and handles unowned functions (M4/PF4)', () => {
  const source = `
instance DIA_A(C_INFO) { npc = N; nr = 1; information = dia_a_info; };
instance DIA_B(C_INFO) { npc = N; nr = 2; information = DIA_B_Info; };

func void DIA_A_Info()
{
    AI_Output (self, other, "DIA_A_00");
};

func void DIA_B_Info()
{
    AI_Output (self, other, "DIA_B_00");
};

func void B_Standalone_Helper()
{
    AI_Output (self, other, "HELPER_00");
};
`;

  const model = parseSemanticModel(source);

  // Case-drifted information ref (dia_a_info) must still cluster its info
  // function's action onto DIA_A's dialog.
  const dialogA = model.dialogs.DIA_A;
  assert.ok(dialogA.actions.some((a) => a.id === 'DIA_A_00'), 'case-drifted info function action clusters onto DIA_A');

  const dialogB = model.dialogs.DIA_B;
  assert.ok(dialogB.actions.some((a) => a.id === 'DIA_B_00'), 'DIA_B info action clusters onto DIA_B');

  // The standalone helper is owned by no dialog: its action must not leak onto
  // any dialog.
  const leaked = [dialogA, dialogB].some((d) => d.actions.some((a) => a.id === 'HELPER_00'));
  assert.ok(!leaked, 'unowned function action must not be attributed to any dialog');
});

// ---------------------------------------------------------------------------
// Review fixes (docs/plans/parser-review-fixes.md)
// ---------------------------------------------------------------------------

// F2: negated builtin condition calls must keep their negation regardless of casing.
test('preserves negation for lowercase !npc_isdead in condition functions', () => {
  const source = `
instance DIA_Dead (C_INFO) { condition = DIA_Dead_Cond; };
func int DIA_Dead_Cond() { if (!npc_isdead(self)) { return TRUE; }; };
`;

  const model = parseSemanticModel(source);
  const { conditions } = model.functions.DIA_Dead_Cond;
  assert.strictEqual(conditions.length, 1);
  assert.strictEqual(conditions[0].type, 'NpcIsDeadCondition');
  assert.strictEqual(conditions[0].negated, true, 'negation must not be lost for lowercase calls');
});

test('preserves negation for lowercase npc_isinstate == FALSE comparisons', () => {
  const source = `
instance DIA_State (C_INFO) { condition = DIA_State_Cond; };
func int DIA_State_Cond() { if (npc_isinstate(self, ZS_Smalltalk) == FALSE) { return TRUE; }; };
`;

  const model = parseSemanticModel(source);
  const { conditions } = model.functions.DIA_State_Cond;
  assert.strictEqual(conditions.length, 1);
  assert.strictEqual(conditions[0].type, 'NpcIsInStateCondition');
  assert.strictEqual(conditions[0].negated, true);
});

test('parses lowercase npc_hasitems comparisons into structured conditions', () => {
  const source = `
instance DIA_Items (C_INFO) { condition = DIA_Items_Cond; };
func int DIA_Items_Cond() { if (npc_hasitems(other, ItMi_Gold) >= 100) { return TRUE; }; };
`;

  const model = parseSemanticModel(source);
  const { conditions } = model.functions.DIA_Items_Cond;
  assert.strictEqual(conditions.length, 1);
  assert.strictEqual(conditions[0].type, 'NpcHasItemsCondition', 'lowercase call should still map to NpcHasItemsCondition');
  assert.strictEqual(conditions[0].operator, '>=');
  assert.strictEqual(conditions[0].value, 100);
});
