const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSemanticModel, deserializeSemanticModel, SemanticCodeGenerator,
  collectReachableFunctions, findFunctionReferences, DialogFunction, CommentAction
} = require('../dist/semantic/semantic-visitor-index');
const DaedalusParser = require('../src/core/parser');

const generator = new SemanticCodeGenerator({ sectionHeaders: false });
const hydrate = model => deserializeSemanticModel(JSON.parse(JSON.stringify(model)));

function parse(source) {
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false, JSON.stringify(model.errors));
  return model;
}

function declarations(source) {
  return DaedalusParser.parseSource(source).rootNode.namedChildren
    .filter(node => node.type === 'function_declaration')
    .map(node => node.childForFieldName('name').text);
}

function comments(source) {
  const result = DaedalusParser.parseSource(source);
  assert.equal(result.hasErrors, false, source);
  const found = [];
  const walk = node => {
    if (node.type === 'comment') {
      found.push(node.text);
    }
    node.namedChildren.forEach(walk);
  };
  walk(result.rootNode);
  return found;
}

function choiceSource(body) {
  return `instance D(C_INFO) { information = Info; };
func void Info() { ${body} };
func void Branch() { Info_AddChoice(D, "Again", Info); };
func void Other() { Touch(); };`;
}

for (const body of [
  'if (Flag /* header */) { Info_AddChoice(D, "Next", branch); };',
  'if (Flag) { Info_AddChoice(D, "Next", Branch); } else if (OtherFlag) { Touch(); };',
  'if (Flag) { Info_AddChoice(D, "Next", Branch); return; };',
  'if (Flag) { if (OtherFlag /* header */) { Info_AddChoice(D, "Next", Branch); }; };'
]) {
  test(`raw choice dependencies remain reachable through export and JSON: ${body}`, () => {
    let model = parse(choiceSource(body));
    for (let cycle = 0; cycle < 3; cycle++) {
      model = hydrate(model);
      assert.deepEqual([...collectReachableFunctions(model, 'info')].sort(), ['Branch', 'Info']);
      assert.equal(findFunctionReferences(model, 'branch').length, 1);
      const output = generator.generateDialogWithFunctions('D', model);
      assert.deepEqual(declarations(output).sort(), ['Branch', 'Info']);
      assert.equal(parse(output).hasErrors, false);
      model = parse(output);
    }
  });
}

test('raw choice analysis follows current text, not stale callSites', () => {
  const model = parse(choiceSource('if (Flag /* header */) { Info_AddChoice(D, "Next", Branch); };'));
  assert.ok(model.functions.Info.callSites.some(call => call.args[2]?.raw === 'Branch'));
  model.functions.Info.actions[0].action = 'if (Flag) { Info_AddChoice(D, "New", Other); };';
  for (const candidate of [model, hydrate(model)]) {
    assert.deepEqual([...collectReachableFunctions(candidate, 'Info')].sort(), ['Info', 'Other']);
    assert.deepEqual(declarations(generator.generateDialogWithFunctions('D', candidate)).sort(), ['Info', 'Other']);
  }
});

test('typed choice edits do not resurrect targets from the original call index', () => {
  const model = parse(choiceSource('Info_AddChoice(D, "Next", Branch);'));
  model.functions.Info.actions[0].targetFunction = 'Other';
  assert.deepEqual([...collectReachableFunctions(hydrate(model), 'Info')].sort(), ['Info', 'Other']);
  model.functions.Info.actions = [];
  assert.deepEqual([...collectReachableFunctions(hydrate(model), 'Info')], ['Info']);
});

test('invalid edited raw statements fail visibly during dependency analysis', () => {
  const model = parse(choiceSource('if (Flag /* header */) { Info_AddChoice(D, "Next", Branch); };'));
  model.functions.Info.actions[0].action = 'Info_AddChoice(D, "Next",';
  assert.throws(() => generator.generateDialogWithFunctions('D', hydrate(model)), /raw action.*valid statements/);
});

test('raw choice analysis uses call ASTs and ignores strings, comments and declined arities', () => {
  const source = choiceSource(`
    if (Flag /* header */) {
      Touch("Info_AddChoice(D, text, Other)");
      // Info_AddChoice(D, text, Other);
      Info_AddChoice(D, "literal", "Other");
      Info_AddChoice(D, "wrong arity", Other, Extra);
      Object.Info_AddChoice(D, "member call", Other);
      iNfO_aDdChOiCe(D, "real", ((Branch)));
    };`);
  const model = hydrate(parse(source));
  assert.deepEqual([...collectReachableFunctions(model, 'Info')].sort(), ['Branch', 'Info']);
});

for (const order of ['parsed', 'absent', 'partial']) {
  test(`export resolves a choice target whose dictionary key differs in case (${order})`, () => {
    const model = hydrate(parse(choiceSource('Info_AddChoice(D, "Next", Branch);')));
    model.functions.BRANCH = model.functions.Branch;
    delete model.functions.Branch;
    if (order === 'absent') {
      delete model.declarationOrder;
    } else if (order === 'partial') {
      model.declarationOrder = [{ type: 'dialog', name: 'D' }];
    }
    assert.deepEqual(declarations(generator.generateDialogWithFunctions('D', model)).sort(), ['Branch', 'Info']);
    assert.deepEqual(declarations(generator.generateSemanticModel(model)).sort(), ['Branch', 'Info', 'Other']);
  });
}

for (const preserveSourceStyle of [true, false]) {
  test(`parsed empty functions remain empty after style normalization and JSON (${preserveSourceStyle})`, () => {
    let model = parse('instance D(C_INFO) { condition = Check; }; func int Check() {}; func void Empty() {};');
    const currentGenerator = new SemanticCodeGenerator({ preserveSourceStyle, sectionHeaders: false });
    for (let cycle = 0; cycle < 3; cycle++) {
      const output = currentGenerator.generateSemanticModel(hydrate(model));
      assert.doesNotMatch(output, /return TRUE|TODO/);
      const root = DaedalusParser.parseSource(output).rootNode;
      for (const declaration of root.namedChildren.filter(node => node.type === 'function_declaration')) {
        assert.equal(declaration.childForFieldName('body').namedChildren.length, 0);
      }
      model = parse(output);
    }
  });
}

test('an explicit success return and a new hand-built integer function retain their defaults', () => {
  const normalized = new SemanticCodeGenerator({ preserveSourceStyle: false });
  const model = hydrate(parse('instance D(C_INFO) { condition = Check; }; func int Check() { return TRUE; };'));
  assert.match(normalized.generateFunction(model.functions.Check), /return TRUE;/);
  assert.match(normalized.generateFunction(new DialogFunction('New', 'int')), /return TRUE;/);
});

test('deleting the last action from parsed functions does not restore generator defaults', () => {
  const model = hydrate(parse('func int F() { Touch(); }; func void G() { Touch(); };'));
  model.functions.F.actions = [];
  model.functions.G.actions = [];

  const output = new SemanticCodeGenerator().generateSemanticModel(model);

  assert.doesNotMatch(output, /return TRUE|TODO: Implement function body/);
  assert.match(output, /func int F\(\)\s*\{\s*\};/);
  assert.match(output, /func void G\(\)\s*\{\s*\};/);
});

test('deleting a comment-only parsed body does not create a placeholder action', () => {
  const model = hydrate(parse('func void F() { // remove me\n};'));
  model.functions.F.actions = [];

  const output = new SemanticCodeGenerator().generateSemanticModel(model);

  assert.doesNotMatch(output, /TODO: Implement function body/);
  assert.match(output, /func void F\(\)\s*\{\s*\};/);
});

for (const newline of ['\n', '\r\n']) {
  for (const declaration of [
    'func void F() { Touch(); }',
    'instance D(C_INFO) { nr = 1; }',
    'instance D(C_INFO) { Touch(); nr = 1; }'
  ]) {
    test(`declaration footer comments survive current body edits and JSON cycles: ${JSON.stringify([newline, declaration])}`, () => {
      const suffix = ' /* footer\n original body-independent text */ // last\n';
      const source = `${declaration}${suffix};`.replace(/\n/g, newline);
      const expectedComments = comments(source);
      let model = parse(source);
      for (let cycle = 0; cycle < 3; cycle++) {
        model = hydrate(model);
        const func = model.functions.F || model.functions.Edited;
        if (func) {
          func.name = 'Edited';
          func.actions[0].action = 'Changed()';
        } else if (!model.dialogs.D.sourceBody) {
          model.dialogs.D.properties.nr = 2;
        }
        const output = new SemanticCodeGenerator({ preserveSourceStyle: false }).generateSemanticModel(model);
        assert.deepEqual(comments(output), expectedComments);
        if (func) {
          assert.match(output, /func void Edited/);
          assert.match(output, /Changed\(\)/);
        } else if (!model.dialogs.D.sourceBody) {
          assert.match(output, /nr\s*=\s*2;/);
        }
        assert.deepEqual(comments(new SemanticCodeGenerator({ includeComments: false }).generateSemanticModel(model)), []);
        model = parse(output);
      }
    });
  }
}

test('standalone comments honor includeComments in direct, nested and raw condition bodies', () => {
  const source = `instance D(C_INFO) { information = Info; condition = Check; };
func void Info() {
  // direct
  if (Flag) { /* nested */ Touch(); };
};
func int Check() { // raw condition
  var int Local;
  return Local;
};`;
  const model = hydrate(parse(source));
  assert.deepEqual(comments(generator.generateSemanticModel(model)), comments(source));
  assert.deepEqual(comments(new SemanticCodeGenerator({ includeComments: false }).generateSemanticModel(model)), []);
  assert.equal(new CommentAction('// manual').generateCode({ includeComments: false }), '');
});
