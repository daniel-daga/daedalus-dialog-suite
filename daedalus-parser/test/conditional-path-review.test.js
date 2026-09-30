const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Script } = require('node:vm');
const {
  parseSemanticModel, deserializeSemanticModel, SemanticCodeGenerator,
  DialogFunction, Condition, VariableCondition
} = require('../dist/semantic/semantic-visitor-index');

const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });
const sourceFor = body => `instance D(C_INFO) { condition = Check; }; func int Check() { ${body} };`;
const bodyOf = code => code.slice(code.indexOf('{') + 1, code.lastIndexOf('}'));

// Exercise both IPC/JSON hydration and repeated parse/generate cycles. The
// oracle is the original source, never a snapshot of the implementation.
function roundtrips(source, check) {
  let model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false, source);
  for (let cycle = 0; cycle < 3; cycle++) {
    const hydrated = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
    for (const candidate of [model, hydrated]) {
      const code = generator.generateSemanticModel(candidate);
      assert.equal(parseSemanticModel(code).hasErrors, false, code);
      check(candidate, generator.generateFunction(candidate.functions.Check));
    }
    model = parseSemanticModel(generator.generateSemanticModel(hydrated));
  }
}

function assertEquivalent(body) {
  const expected = new Script(`(function () { ${body} })()`);
  roundtrips(sourceFor(body), (_model, generated) => {
    const actual = new Script(`(function () { ${bodyOf(generated)} })()`);
    for (const A of [0, 1, 2]) for (const B of [0, 1, 2]) for (const C of [0, 1, 2]) {
      const values = { A, B, C, TRUE: 1, FALSE: 0, other: 0, item: 0, Npc_HasItems: () => C };
      assert.equal(Boolean(actual.runInNewContext(values)), Boolean(expected.runInNewContext(values)),
        `${body}; A=${A}, B=${B}, C=${C}\n${generated}`);
    }
  });
}

for (const expression of ['A < B < C', 'A == B == C', 'A != B == C', 'A < B < Npc_HasItems(other, item)']) {
  test(`comparison associativity survives the full conditional path: ${expression}`, () => {
    assertEquivalent(`if (${expression}) { return TRUE; };`);
  });
}

test('comparison normalization does not reorder effectful operands', () => {
  const body = 'if (Probe() + 1 < Npc_HasItems(other, item)) { return TRUE; };';
  roundtrips(sourceFor(body), (_model, generated) => {
    const trace = [];
    new Script(`(function () { ${bodyOf(generated)} })()`).runInNewContext({
      Probe: () => { trace.push('probe'); return 1; },
      Npc_HasItems: () => { trace.push('items'); return 3; },
      other: 0, item: 0, TRUE: 1
    });
    assert.deepEqual(trace, ['probe', 'items'], generated);
  });
});

for (const call of ['Npc_IsDead(other)', 'Npc_IsInState(other, state)']) {
  test(`boolean normalization retains a quoted comparison operand: ${call}`, () => {
    roundtrips(sourceFor(`if (${call} == "FALSE") { return TRUE; };`), (_model, generated) => {
      assert.ok(generated.includes(`${call} == "FALSE"`), generated);
    });
  });
}

for (const expression of ['(A == "(") || (B == ")")', 'A // guard note\n']) {
  test(`action condition uses syntax boundaries, not text heuristics: ${expression}`, () => {
    const source = `func void Check() { if ${expression === 'A // guard note\n' ? `(${expression})` : expression} { Run(); }; };`;
    roundtrips(source, (_model, generated) => {
      assert.ok(generated.includes(expression.trim()), generated);
    });
  });
}

for (const body of [
  '// only a comment\n',
  '// before\nif (A) { return TRUE; };',
  'if (A) { /* return note */ return TRUE; };',
  'if (A) { return TRUE; }; // after\n',
  'if /* header */ (A) { return TRUE; };',
  'if (Npc_HasItems(other, /* item */ item) > 0) { return TRUE; };'
]) {
  test(`condition comments are preserved without inventing success: ${body}`, () => {
    const comments = body.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g);
    roundtrips(sourceFor(body), (_model, generated) => {
      for (const comment of comments) assert.ok(generated.includes(comment), generated);
      if (body.startsWith('// only')) assert.doesNotMatch(generated, /return\s+TRUE/i);
    });
  });
}

test('nested guards retain their control-flow boundary across IPC and generation', () => {
  const body = 'if (Outer()) { if (Inner()) { return TRUE; }; };';
  roundtrips(sourceFor(body), (_model, generated) => {
    // Flattening into && assumes the target language/compiler short-circuits.
    // The source's explicit branch is stronger and must not be erased.
    assert.equal((generated.match(/\bif\s*\(/g) || []).length, 2, generated);
    assert.doesNotMatch(generated, /&&/);
  });
});

test('generic editor-created clauses retain grouping when combined', () => {
  const fn = new DialogFunction('Check', 'int');
  fn.conditions = [new Condition('A || B'), new VariableCondition('C')];
  const body = bodyOf(generator.generateFunction(fn));
  const actual = new Script(`(function () { ${body} })()`);
  assert.equal(Boolean(actual.runInNewContext({ A: 1, B: 0, C: 0, TRUE: 1 })), false, body);
});

test('generic clauses ending in a line comment cannot swallow generated delimiters', () => {
  const fn = new DialogFunction('Check', 'int');
  fn.conditions = [new Condition('A // note'), new VariableCondition('B')];
  const generated = generator.generateFunction(fn);
  assert.equal(parseSemanticModel(generated).hasErrors, false, generated);
  fn.conditions.pop();
  const single = generator.generateFunction(fn);
  assert.equal(parseSemanticModel(single).hasErrors, false, single);
});

test('logical clause roots are captured once across expression families', () => {
  // Cover combinations rather than one fixture per recently reported syntax.
  const atoms = ['A', '!A', '!(A == B)', 'A < B < C', '(A + B)', '((A | B) == C)'];
  for (const atom of atoms) for (const operator of ['&&', '||']) {
    assertEquivalent(`if ((${atom}) ${operator} C) { return TRUE; };`);
  }
});

test('single-dialog export includes choices nested in branches and their transitive targets', () => {
  const source = `
    instance D(C_INFO) { information = Check; };
    func void Check() {
      if (A) { Info_AddChoice(D, "first", bRaNcH); }
      else { Info_AddChoice(D, "second", Other); };
    };
    func void Branch() {
      Info_AddChoice(D, "again", cHeCk);
      Info_AddChoice(D, "deeper", Leaf);
    };
    func void Other() {};
    func void Leaf() {};
  `;
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false);
  for (const candidate of [model, deserializeSemanticModel(JSON.parse(JSON.stringify(model)))]) {
    const generated = generator.generateDialogWithFunctions('D', candidate);
    const reparsed = parseSemanticModel(generated);
    assert.equal(reparsed.hasErrors, false, generated);
    assert.deepEqual(Object.keys(reparsed.functions).sort(), ['Branch', 'Check', 'Leaf', 'Other']);
    for (const name of ['Branch', 'Check', 'Leaf', 'Other']) {
      assert.equal(generated.split(`func void ${name}(`).length - 1, 1, generated);
    }
  }
});
