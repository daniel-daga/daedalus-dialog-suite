const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Script } = require('node:vm');
const { parseSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');

// Review regressions from 2026-09-29, retained as focused fidelity checks.
const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });

function generatedConditionBody(body) {
  const source = `instance D(C_INFO) { condition = Cond; }; func int Cond() { ${body} };`;
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false);
  const generated = generator.generateFunction(model.functions.Cond);
  return generated.slice(generated.indexOf('{') + 1, generated.lastIndexOf('}'));
}

// These fixtures use only syntax whose boolean behavior is shared with JS.
// This checks observable truth tables, allowing either structured or raw fixes.
function assertTruthTable(body) {
  const actual = new Script(`(function () { ${generatedConditionBody(body)} })()`);
  const expected = new Script(`(function () { ${body} })()`);
  for (let mask = 0; mask < 8; mask++) {
    const values = { A: mask & 1, B: (mask >> 1) & 1, C: (mask >> 2) & 1, flags: mask, TRUE: 1 };
    assert.equal(Boolean(actual.runInNewContext(values)), Boolean(expected.runInNewContext(values)), `inputs=${JSON.stringify(values)}`);
  }
}

test('R1: preserve AND between nested if guards with an inner OR', () => {
  assertTruthTable('if (A) { if (B || C) { return TRUE; }; };');
});

test('R2: do not add descendants of a captured negated expression', () => {
  assertTruthTable('if (!(A || B)) { return TRUE; };');
});

test('R3: preserve a bitmask guard', () => {
  assertTruthTable('if (flags & 1) { return TRUE; };');
});

test('R4: retain an unconditional trailing TRUE return', () => {
  assertTruthTable('if (A) { return TRUE; }; return TRUE;');
});

test('R5: comments between assignment operands do not replace the operator', () => {
  const model = parseSemanticModel('func void F() { value /* note */ += 1; };');
  assert.equal(model.hasErrors, false);
  const generated = generator.generateFunction(model.functions.F);
  assert.equal(parseSemanticModel(generated).hasErrors, false, generated);
  assert.match(generated, /\+=\s*1;/);
});

test('R6: preserve literal quotes in a string comparison', () => {
  const body = generatedConditionBody('if (name == "Hero") { return TRUE; };');
  assert.match(body, /name\s*==\s*"Hero"/);
});
