const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');
const { SemanticCodeGenerator } = require('../dist/codegen/generator');

function parse(source) {
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false, JSON.stringify(model.errors));
  return model;
}

function roundtripCondition(expression) {
  const source = `
instance DIA_Test(C_INFO) { condition = Check; };
func int Check() { if (${expression}) { return TRUE; }; };
`;
  const model = parse(source);
  const generated = new SemanticCodeGenerator().generateSemanticModel(model);
  parse(generated);
  return generated;
}

test('review control: directly mixed AND/OR keeps its expression', () => {
  const generated = roundtripCondition('(A || B) && C');
  assert.ok(generated.includes('(A || B) && C'), generated);
});

test('review finding 1: deeply nested AND/OR retains the nested OR', () => {
  const generated = roundtripCondition('((A || B) && C) && D');
  // A=0, B=C=D=1 must still satisfy the generated condition.
  assert.match(generated, /\bA\s*\|\|\s*B\b/, generated);
});

test('review finding 2: accepted string comparison retains its literal quotes', () => {
  const generated = roundtripCondition('name == "Bob"');
  assert.match(generated, /name\s*==\s*"Bob"/, generated);
});

const dialogs = `
instance DIA_First(C_INFO) { information = Shared_Info; };
instance DIA_Second(C_INFO) { information = Shared_Info; };
`;
const information = `
func void Shared_Info() { AI_Output(self, other, "SHARED_01"); };
`;

function assertSharedActions(source) {
  const model = parse(source);
  const func = model.functions.Shared_Info;
  assert.equal(func.actions.length, 1);
  assert.equal(model.dialogs.DIA_First.properties.information, func);
  assert.equal(model.dialogs.DIA_Second.properties.information, func);
  const counts = Object.values(model.dialogs).map(dialog => dialog.actions.length);
  assert.deepEqual(counts, [1, 1], `dialog action counts: ${JSON.stringify(counts)}`);
}

test('review finding 3: both dialogs receive actions when function follows them', () => {
  assertSharedActions(dialogs + information);
});

test('review control: both dialogs receive actions when function precedes them', () => {
  assertSharedActions(information + dialogs);
});
