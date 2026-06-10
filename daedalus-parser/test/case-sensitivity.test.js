const { test } = require('node:test');
const assert = require('node:assert');
const { createParser } = require('./helpers');
const { SemanticModelBuilderVisitor, parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');

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
