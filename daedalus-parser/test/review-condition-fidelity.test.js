const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Script } = require('node:vm');
const { parseSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');
const { deserializeSemanticModel } = require('../dist/semantic/semantic-model');

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

test('R7: comments do not change comparison operands', () => {
  assertTruthTable('if (A /* left */ == /* right */ B) { return TRUE; };');
  assertTruthTable('if (1 /* left */ <= /* right */ flags) { return TRUE; };');
});

test('R8: preserve AND between an outer OR guard and a nested guard', () => {
  assertTruthTable('if (A || B) { if (C) { return TRUE; }; };');
});

for (const call of [
  'Npc_KnowsInfo(other, D, extra)',
  'Npc_HasItems(other, item, extra)',
  'Npc_IsInState(other, state, extra)',
  'Npc_IsDead(other, extra)',
  'Npc_GetDistToWP(other, "WP", extra)',
  'Npc_GetTalentSkill(other, talent, extra)',
  'Npc_KnowsInfo()',
  'Npc_IsDead()',
  '!Npc_IsDead(other, extra)',
  'Npc_HasItems(other, item, extra) >= 1',
  'Npc_IsInState(other, state, extra) == TRUE'
]) {
  test(`R9: preserve unsupported condition arity: ${call}`, () => {
    const body = generatedConditionBody(`if (${call}) { return TRUE; };`);
    assert.ok(body.includes(call), body);
  });
}

// #395: an unedited projected guard keeps its source spelling. The MDK writes
// guards the structured model cannot spell back (no parentheses, `(A) && (B)`,
// `== FALSE`, `IF`, `return 1`), and regenerating them was Tier 1 token drift.
const styledGenerator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false, preserveSourceStyle: true });
const collapse = text => text.replace(/\s+/g, ' ').trim();

function regenerate(source, name = 'Cond') {
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false);
  return { model, generated: styledGenerator.generateFunction(model.functions[name]) };
}

for (const statement of [
  'if Npc_IsInState (self, ZS_Talk) { return TRUE; };',
  'if (Npc_IsInState(self, ZS_Talk)) && (B_GetPlayerCrime(self) != CRIME_NONE) { return TRUE; };',
  'if (Npc_IsDead(UndeadDragon) == FALSE) && (ORkSturmDI == FALSE) { return TRUE; };',
  'if !(Npc_IsDead (Alvares)) && !(Npc_IsDead (Engardo)) { return TRUE; };',
  'IF (Npc_KnowsInfo(other, DIA_First)) { return TRUE; };',
  'return 1;'
]) {
  test(`#395: an unedited guard regenerates in its source spelling: ${statement}`, () => {
    const { generated } = regenerate(`instance D(C_INFO) { condition = Cond; }; func int Cond() { ${statement} };`);
    assert.ok(collapse(generated).includes(statement), generated);
  });
}

test('#395: an edited guard is generated from the conditions, not the stale source', () => {
  const guard = 'if (Npc_KnowsInfo(other, DIA_First)) && (Npc_KnowsInfo(other, DIA_Second)) { return TRUE; };';
  const { model } = regenerate(`instance D(C_INFO) { condition = Cond; }; func int Cond() { ${guard} };`);
  const cond = model.functions.Cond;
  cond.conditions.pop();
  const generated = styledGenerator.generateFunction(cond);
  assert.ok(generated.includes('DIA_First'), generated);
  assert.ok(!generated.includes('DIA_Second'), generated);

  cond.conditionOperator = 'OR';
  cond.conditions.push(cond.conditions[0]);
  assert.ok(collapse(styledGenerator.generateFunction(cond)).includes('|| Npc_KnowsInfo'));
});

// Editing one clause rewrites that clause only; the others, and the guard's
// layout while the clause count and operator stand, keep their spelling.
const threeClauses = 'if (Npc_IsDead(UndeadDragon) == FALSE)\n\t&& (Npc_KnowsInfo(other, DIA_First))\n\t&& !(Npc_IsDead (Alvares)) { return TRUE; };';
const parseThree = () => regenerate(`instance D(C_INFO) { condition = Cond; }; func int Cond() { ${threeClauses} };`).model.functions.Cond;

test('#395: editing one clause leaves the rest of the guard as written', () => {
  const cond = parseThree();
  cond.conditions[1].dialogRef = 'DIA_Second';
  const generated = styledGenerator.generateFunction(cond);
  assert.ok(generated.includes(threeClauses.replace('DIA_First', 'DIA_Second')), generated);
});

test('#395: removing a clause keeps the survivors\' spelling', () => {
  const cond = parseThree();
  cond.conditions.splice(1, 1);
  const generated = styledGenerator.generateFunction(cond);
  assert.ok(generated.includes('Npc_IsDead(UndeadDragon) == FALSE'), generated);
  assert.ok(generated.includes('!(Npc_IsDead (Alvares))'), generated);
  assert.ok(!generated.includes('DIA_First'), generated);
  assert.equal(parseSemanticModel(generated).hasErrors, false, generated);
});

test('#395: a clause hydrated the way the condition editor does it, or moved, keeps its spelling', () => {
  const cond = parseThree();
  cond.conditions = cond.conditions.map(c => ({ ...c, line: c.line + 5, getTypeName: () => c.type }));
  const generated = styledGenerator.generateFunction(cond);
  assert.ok(generated.includes(threeClauses), generated);
});

test('#395: the source spelling survives the editor\'s JSON round trip', () => {
  const source = 'instance D(C_INFO) { condition = Cond; }; func int Cond() { if Npc_IsInState (self, ZS_Talk) { return TRUE; }; };';
  const model = deserializeSemanticModel(JSON.parse(JSON.stringify(parseSemanticModel(source))));
  const generated = styledGenerator.generateFunction(model.functions.Cond);
  assert.ok(collapse(generated).includes('if Npc_IsInState (self, ZS_Talk) {'), generated);
});
