const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParser } = require('./helpers');
const {
  parseSemanticModel, deserializeSemanticModel, SemanticCodeGenerator, SetVariableAction
} = require('../dist/semantic/semantic-visitor-index');

function hydrate(model) { return deserializeSemanticModel(JSON.parse(JSON.stringify(model))); }
function assignment(actions) {
  for (const action of actions) {
    if (action instanceof SetVariableAction) { return action; }
    if (action.type === 'ConditionalAction') {
      const found = assignment([...action.thenActions, ...action.elseActions]);
      if (found) { return found; }
    }
  }
  return undefined;
}

function comments(source) {
  const root = createParser().parse(source).rootNode;
  assert.equal(root.hasError, false, source);
  const result = [];
  const visit = node => {
    if (node.type === 'comment') { result.push(node.text); } else { node.namedChildren.forEach(visit); }
  };
  visit(root);
  return result;
}

const statements = [
  'x /* left ä */ = 01;',
  'x = /* leading */ 1 /* trailing */;',
  'x // left\n= 1;',
  'x = // leading\n1 // trailing\n;',
  'self /* member */ .nr /* outside */ += Amount /* inside */ + 2;',
  'values[INDEX /* index */] /* outside */ *= 2;',
  'x /* multiline\n  "quoted" ä\n*/ -= 2;',
  'x /* outside */ = "a\nb";'
];
const branches = [body => body, body => `if (Flag) { ${body} };`,
  body => `if (Flag) { Touch(); } else { ${body} };`, body => `if (Flag) { if (Other) { ${body} }; };`];

for (const statement of statements) {
  test(`assignment comments and literal spelling survive JSON and repeated generation: ${statement}`, () => {
    for (const branch of branches) {
      const source = `func void F() { ${branch(statement)} };`;
      const expected = comments(source);
      let model = parseSemanticModel(source);
      const initialAction = assignment(model.functions.F.actions);
      assert.ok(initialAction instanceof SetVariableAction);
      assert.equal(new SemanticCodeGenerator().generateAction(initialAction), statement);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        model = hydrate(model);
        const output = new SemanticCodeGenerator().generateSemanticModel(model);
        assert.deepEqual(comments(output), expected);
        model = parseSemanticModel(output);
        assert.ok(assignment(model.functions.F.actions) instanceof SetVariableAction);
      }
    }
  });
}

test('current name, operator and value replace their own ranges while gap comments survive', () => {
  for (const branch of branches) {
    let model = hydrate(parseSemanticModel(`func void F() { ${branch('self /* old */ .nr /* gap */ += Amount /* old value */ + 2;')} };`));
    const action = assignment(model.functions.F.actions);
    action.variableName = 'values[0]';
    action.operator = '*=';
    action.value = 'OTHER + 5';
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const output = new SemanticCodeGenerator().generateSemanticModel(hydrate(model));
      assert.deepEqual(comments(output), ['/* gap */']);
      model = parseSemanticModel(output);
      const edited = assignment(model.functions.F.actions);
      assert.equal(edited.variableName, 'values[0]');
      assert.equal(edited.operator, '*=');
      assert.equal(edited.value, 'OTHER + 5');
    }
  }
});

for (const value of ['/* new */ 5', '5 /* new */', '// new\n5', '5 // new\n', 'Amount /* new */ + 3']) {
  test(`new comments authored in an edited value remain effective: ${value}`, () => {
    let model = hydrate(parseSemanticModel('func void F() { x /* gap */ = Amount /* old */ + 1; };'));
    assignment(model.functions.F.actions).value = value;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const output = new SemanticCodeGenerator().generateSemanticModel(hydrate(model));
      assert.ok(!output.includes('/* old */'), output);
      assert.deepEqual(comments(output), ['/* gap */', value.includes('//') ? '// new' : '/* new */']);
      model = parseSemanticModel(output);
    }
  });
}

test('numeric edits do not replay original literal spelling or stale source', () => {
  const model = hydrate(parseSemanticModel('func void F() { x /* keep */ = 01; };'));
  const action = assignment(model.functions.F.actions);
  action.value = 3.75;
  assert.equal(new SemanticCodeGenerator().generateAction(action), 'x /* keep */ = 3.75;');
});

test('invalid edited statements and unsupported metadata fail visibly', () => {
  for (const change of [a => { a.operator = '=='; }, a => { a.value = '1; Other()'; },
    a => { a.sourceAssignment.version = 99; }]) {
    const model = hydrate(parseSemanticModel('func void F() { x /* keep */ = 1; };'));
    const action = assignment(model.functions.F.actions);
    assert.ok(action.sourceAssignment);
    change(action);
    assert.throws(() => new SemanticCodeGenerator().generateSemanticModel(model), /commented assignment|assignment source metadata/i);
  }
});

test('includeComments false generates current typed values without source replay', () => {
  const model = hydrate(parseSemanticModel('func void F() { x /* keep */ = 1; };'));
  const action = assignment(model.functions.F.actions);
  action.value = 8;
  assert.equal(new SemanticCodeGenerator({ includeComments: false }).generateAction(action), 'x = 8;');
});
