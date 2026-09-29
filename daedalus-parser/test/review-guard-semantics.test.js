const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Script } = require('node:vm');
const { parseSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');

const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });

// Compare observable return values, without prescribing structured vs raw mode.
function assertEquivalent(body) {
  const source = `instance D(C_INFO) { condition = Check; }; func int Check() { ${body} };`;
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false);
  const generated = generator.generateFunction(model.functions.Check);
  assert.equal(parseSemanticModel(generated).hasErrors, false, generated);
  const actualBody = generated.slice(generated.indexOf('{') + 1, generated.lastIndexOf('}'));
  const actual = new Script(`(function () { ${actualBody} })()`);
  const expected = new Script(`(function () { ${body} })()`);
  for (let mask = 0; mask < 8; mask++) {
    const values = {
      A: mask & 1, B: (mask >> 1) & 1, C: (mask >> 2) & 1,
      TRUE: 1, FALSE: 0, self: { level: mask & 1 }, flags: [mask & 1],
      other: 0, item: 0, Npc_IsDead: () => mask & 1,
      Npc_HasItems: () => mask & 1
    };
    assert.equal(Boolean(actual.runInNewContext(values)), Boolean(expected.runInNewContext(values)),
      `${body}, mask=${mask}\n${generated}`);
  }
}

for (const expression of [
  '!(A == B)',
  '!(Npc_HasItems(other, item) >= 1)',
  '!(Npc_IsDead(other))',
  '!(A < B) || C',
  'Npc_IsDead(A == B)',
  'Npc_HasItems(A < B, item)'
]) {
  test(`negated guard is captured once: ${expression}`, () => {
    assertEquivalent(`if (${expression}) { return TRUE; };`);
  });
}

for (const expression of ['0', '0 && A', '1 || A', 'self.level', 'flags[0]', '(flags[0] || B) && C']) {
  test(`atomic guard is retained: ${expression}`, () => {
    assertEquivalent(`if (${expression}) { return TRUE; };`);
  });
}

for (const expression of [
  'A /* left */ && (B || C)',
  '(A || B) /* right */ && C',
  '(/* grouped */ A || B) && C',
  'A && (B /* left */ || C)'
]) {
  test(`comments do not change logical grouping: ${expression}`, () => {
    assertEquivalent(`if (${expression}) { return TRUE; };`);
  });
}

for (const body of [
  'if (A) {};',
  'if (A) { if (B) {}; };',
  'if (A) { if (B) { return TRUE; }; return TRUE; };',
  'if (A) { if (B) { return TRUE; }; if (C) { return TRUE; }; };',
  'return TRUE; if (A) { return TRUE; };'
]) {
  test(`guard control flow is retained: ${body}`, () => {
    assertEquivalent(body);
  });
}
