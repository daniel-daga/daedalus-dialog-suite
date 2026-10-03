const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParser } = require('./helpers');
const {
  parseSemanticModel, deserializeSemanticModel, SemanticCodeGenerator, Dialog, DialogFunction
} = require('../dist/semantic/semantic-visitor-index');

function parse(code) {
  const model = parseSemanticModel(code);
  assert.equal(model.hasErrors, false, JSON.stringify(model.errors));
  return model;
}

function hydrate(model) {
  return deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
}

function comments(code) {
  const tree = createParser().parse(code);
  assert.equal(tree.rootNode.hasError, false, code);
  return tree.rootNode.descendantsOfType('comment').map(node => node.text);
}

for (const value of ['Trade', 'Hügo', '1', '']) {
  test(`edited literal property retains string identity: ${JSON.stringify(value)}`, () => {
    let model = parse('instance D(C_INFO) { description = "old"; custom = "old"; }; func void Trade() {};');
    model.dialogs.D.properties.description = value;
    model.dialogs.D.properties.custom = value;
    for (let cycle = 0; cycle < 3; cycle++) {
      model = hydrate(model);
      const code = new SemanticCodeGenerator({ preserveSourceStyle: cycle !== 1 }).generateSemanticModel(model);
      model = parse(code);
      assert.equal(model.dialogs.D.properties.description, `"${value}"`, code);
      assert.equal(model.dialogs.D.properties.custom, `"${value}"`, code);
    }
  });
}

test('documented hand-built description is a string literal', () => {
  const dialog = new Dialog('D', 'C_INFO');
  dialog.properties.description = 'Trade';
  const func = new DialogFunction('Trade', 'void');
  const model = hydrate({ dialogs: { D: dialog }, functions: { Trade: func } });
  const code = new SemanticCodeGenerator().generateSemanticModel(model);
  assert.equal(parse(code).dialogs.D.properties.description, '"Trade"', code);
});

test('explicit expression metadata takes precedence over description literal default', () => {
  const model = hydrate(parse('instance D(C_INFO) { description = Text; };'));
  model.dialogs.D.properties.description = 'ChangedText';
  const code = new SemanticCodeGenerator({ preserveSourceStyle: false }).generateSemanticModel(model);
  assert.equal(parse(code).dialogs.D.properties.description, 'ChangedText', code);
});

test('legacy JSON without literal metadata retains identifier inference', () => {
  const model = hydrate({ dialogs: { D: { name: 'D', parent: 'C_INFO', properties: { custom: 'Text' } } }, functions: {} });
  const code = new SemanticCodeGenerator().generateSemanticModel(model);
  assert.equal(parse(code).dialogs.D.properties.custom, 'Text', code);
});

const headers = [
  'func /* keyword */ void F(/* empty */) /* body */ { return; };',
  'func void /* type */ F /* name */ (var /* keyword */ int /* type */ x, /* between */ string y) { return; };',
  'func void F(var // parameter\n int x) // body\n { return; };',
  'instance /* keyword */ D /* name */ (/* open */ C_INFO /* parent */) /* body */ { nr = 1; };'
];

for (const source of headers) {
  test(`header comments survive JSON and three cycles: ${source}`, () => {
    let model = parse(source);
    const original = comments(source);
    for (let cycle = 0; cycle < 3; cycle++) {
      model = hydrate(model);
      const code = new SemanticCodeGenerator({ preserveSourceStyle: cycle !== 1 }).generateSemanticModel(model);
      assert.deepEqual(comments(code), original, code);
      model = parse(code);
    }
    const without = new SemanticCodeGenerator({ includeComments: false }).generateSemanticModel(model);
    assert.deepEqual(comments(without), []);
  });
}

test('header preservation applies current function, parameter and dialog edits', () => {
  const source = 'func /* header */ void F(var /* parameter */ int /* type */ x) /* body */ {};'
    + 'instance /* dialog */ D(C_INFO /* parent */) { nr = 1; };';
  const model = hydrate(parse(source));
  Object.assign(model.functions.F, { name: 'Renamed', returnType: 'int' });
  Object.assign(model.functions.F.parameters[0], { name: 'other', type: 'string', keyword: 'const' });
  model.dialogs.D.name = 'RenamedDialog';
  model.dialogs.D.properties.nr = 2;
  const code = new SemanticCodeGenerator().generateSemanticModel(model);
  const edited = parse(code);
  assert.equal(edited.functions.Renamed.returnType, 'int');
  assert.deepEqual(edited.functions.Renamed.parameters, [{ keyword: 'const', type: 'string', name: 'other' }]);
  assert.equal(edited.dialogs.RenamedDialog.properties.nr, 2);
  assert.deepEqual(comments(code), comments(source));
});

test('changing parameter arity preserves header comments and current parameters', () => {
  const source = 'func void F(/* before */ var int x /* after */) {};';
  const model = hydrate(parse(source));
  model.functions.F.parameters = [{ type: 'string', name: 'changed' }, { keyword: 'var', type: 'int', name: 'n' }];
  const code = new SemanticCodeGenerator().generateSemanticModel(model);
  assert.deepEqual(parse(code).functions.F.parameters, model.functions.F.parameters);
  assert.deepEqual(comments(code), comments(source));
});

for (const newline of ['\n', '\r\n']) {
  test(`projected condition block comments remain exact, newline=${JSON.stringify(newline)}`, () => {
    const before = ['/* before', '  ä detail', '*/'].join(newline);
    const after = ['/* after', '  detail', '*/'].join(newline);
    const source = 'instance D(C_INFO) { condition = Check; };\n'
      + `func int Check() { ${before}\n if (Flag) { return TRUE; };\n${after}\n};`;
    let model = parse(source);
    for (let cycle = 0; cycle < 3; cycle++) {
      model = hydrate(model);
      const code = new SemanticCodeGenerator().generateSemanticModel(model);
      assert.deepEqual(comments(code), [before, after], code);
      model = parse(code);
      assert.equal(model.functions.Check.conditions.length, 1);
    }
  });
}
