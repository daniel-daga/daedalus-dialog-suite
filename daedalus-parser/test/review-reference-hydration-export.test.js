const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSemanticModel, deserializeSemanticModel, SemanticCodeGenerator,
  collectReachableFunctions, findFunctionReferences, findDialogReferences,
  Dialog, DialogFunction, Action
} = require('../dist/semantic/semantic-visitor-index');
const DaedalusParser = require('../src/core/parser');

const generator = new SemanticCodeGenerator({ sectionHeaders: false });
const hydrate = model => deserializeSemanticModel(JSON.parse(JSON.stringify(model)));

function parse(source) {
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false, JSON.stringify(model.errors));
  return model;
}

function functionNames(source) {
  return Object.keys(parse(source).functions).sort();
}

function commentTokens(source) {
  const result = DaedalusParser.parseSource(source);
  assert.equal(result.hasErrors, false, source);
  const comments = [];
  const walk = node => {
    if (node.type === 'comment') comments.push(node.text);
    node.namedChildren.forEach(walk);
  };
  walk(result.rootNode);
  return comments;
}

function choicesSource(body) {
  return `instance D(C_INFO) { information = Info; };
func void Info() { ${body} };
func void Branch() { Info_AddChoice(D, "Again", (info)); };
func void Other() {};`;
}

for (const body of [
  'Info_AddChoice(D, "Next", ((branch)));',
  'if (Flag) { Info_AddChoice(D, "Next", ((branch))); };',
  'if (Flag /* raw header */) { Info_AddChoice(D, "Next", ((branch))); };'
]) {
  test(`choice identity is independent of structured/raw projection: ${body}`, () => {
    let model = parse(choicesSource(body));
    for (let cycle = 0; cycle < 3; cycle++) {
      model = hydrate(model);
      assert.deepEqual([...collectReachableFunctions(model, 'Info')].sort(), ['Branch', 'Info']);
      assert.equal(findFunctionReferences(model, 'Branch').length, 1);
      const output = generator.generateDialogWithFunctions('D', model);
      assert.deepEqual(functionNames(output), ['Branch', 'Info']);
      assert.match(output, /\(\(branch\)\)/);
      model = parse(output);
    }
  });
}

test('structured choice analysis follows current wrapped targets and rejects non-identifiers', () => {
  const model = parse(choicesSource('Info_AddChoice(D, "Next", Branch);'));
  const choice = model.functions.Info.actions[0];
  choice.targetFunction = '((Other /* identifier trivia */))';
  assert.deepEqual([...collectReachableFunctions(model, 'Info')].sort(), ['Info', 'Other']);
  assert.equal(findFunctionReferences(model, 'Branch').length, 0);
  assert.equal(findFunctionReferences(model, 'Other').length, 1);
  assert.match(generator.generateDialogWithFunctions('D', model), /Other \/\* identifier trivia \*\//);
  for (const target of ['"Branch"', 'Object.Branch', 'GetBranch()', 'Branch + 1']) {
    choice.targetFunction = target;
    assert.deepEqual([...collectReachableFunctions(hydrate(model), 'Info')], ['Info'], target);
    assert.equal(findFunctionReferences(model, 'Branch').length, 0, target);
  }
});

test('a parsed quoted choice callback stays a string rather than becoming a function reference', () => {
  const model = hydrate(parse(choicesSource('Info_AddChoice(D, "Next", "Branch");')));
  assert.equal(model.functions.Info.actions[0].targetFunction, '"Branch"');
  assert.deepEqual([...collectReachableFunctions(model, 'Info')], ['Info']);
  assert.equal(findFunctionReferences(model, 'Branch').length, 0);
  const output = generator.generateDialogWithFunctions('D', model);
  assert.match(output, /"Next", "Branch"/);
  assert.deepEqual(functionNames(output), ['Info']);
});

test('wrapped information and condition properties resolve without losing their source expressions', () => {
  let model = parse(`func int Check() { if (Flag) { return TRUE; }; };
func void Info() { Info_AddChoice(D, "Next", (Branch)); };
func void Branch() {};
instance D(C_INFO) { Condition = ((check)); Information = (Info); };`);
  for (let cycle = 0; cycle < 3; cycle++) {
    model = hydrate(model);
    assert.equal(model.functions.Check.conditions.length, 1);
    assert.equal(findFunctionReferences(model, 'Check').length, 1);
    assert.equal(findFunctionReferences(model, 'Info').length, 1);
    assert.strictEqual(model.dialogs.D.actions, model.functions.Info.actions);
    const output = generator.generateDialogWithFunctions('D', model);
    assert.deepEqual(functionNames(output), ['Branch', 'Check', 'Info']);
    assert.match(output, /Condition\s*=\s*\(\(check\)\)/);
    assert.match(output, /Information\s*=\s*\(Info\)/);
    model = parse(output);
  }
});

test('wrapped Npc_KnowsInfo references use identifier identity without changing call arguments', () => {
  const model = hydrate(parse(`instance D(C_INFO) { condition = Check; };
func int Check() { if (Npc_KnowsInfo(other, ((d)))) { return TRUE; }; };`));
  assert.equal(findDialogReferences(model, 'D').length, 1);
  assert.match(generator.generateSemanticModel(model), /Npc_KnowsInfo\(other, \(\(d\)\)\)/);
});

test('literal function-name properties do not become references after model edits or hydration', () => {
  const model = parse('instance D(C_INFO) { information = "Info"; }; func void Info() {};');
  model.dialogs.D.properties.information = 'Info';
  for (const candidate of [model, hydrate(model)]) {
    assert.equal(findFunctionReferences(candidate, 'Info').length, 0);
    assert.deepEqual(functionNames(generator.generateDialogWithFunctions('D', candidate)), []);
    assert.equal(candidate.dialogs.D.actions.length, 0);
  }
});

for (const functionsFirst of [false, true]) {
  test(`dialog actions share the current information function across hydration and edits (${functionsFirst})`, () => {
    const declarations = 'instance A(C_INFO) { information = Info; }; instance B(C_INFO) { Information = info; };';
    const functions = 'func void Info() { Touch(); }; func void Other() { Changed(); };';
    let model = parse(functionsFirst ? functions + declarations : declarations + functions);
    for (let cycle = 0; cycle < 3; cycle++) {
      model = hydrate(model);
      const info = model.functions.Info;
      assert.strictEqual(model.dialogs.A.actions, info.actions);
      assert.strictEqual(model.dialogs.B.actions, info.actions);
      assert.equal(info.actions.length, 1, 'extraction must not double-push shared actions');
      info.actions = [new Action('Edited()')];
      assert.strictEqual(model.dialogs.A.actions, info.actions, 'array replacement must remain visible');
      model.dialogs.B.actions.push(new Action('Second()'));
      assert.equal(info.actions.length, 2, 'mutating either view changes the same body');
      model.dialogs.A.actions = [new Action('Assigned()')];
      assert.strictEqual(model.dialogs.B.actions, info.actions, 'assigning the view replaces the linked body');
      assert.equal(info.actions.length, 1);
      model.dialogs.A.properties.information = model.functions.Other;
      assert.strictEqual(model.dialogs.A.actions, model.functions.Other.actions);
      model.dialogs.A.properties.information = '((info))';
      assert.strictEqual(model.dialogs.A.actions, info.actions, 'current wrapped string relinking must work');
      const json = JSON.parse(JSON.stringify(model));
      assert.equal(json.dialogs.A.actions[0].action, 'Assigned()');
      model = parse(generator.generateSemanticModel(model));
    }
  });
}

test('linked function actions override a stale serialized dialog snapshot', () => {
  const model = parse('instance D(C_INFO) { information = Info; }; func void Info() { Current(); };');
  const json = JSON.parse(JSON.stringify(model));
  json.dialogs.D.actions = [{ type: 'Action', action: 'Stale()' }];
  const hydrated = deserializeSemanticModel(json);
  assert.strictEqual(hydrated.dialogs.D.actions, hydrated.functions.Info.actions);
  assert.equal(hydrated.dialogs.D.actions[0].action, 'Current()');
});

test('standalone legacy and newly constructed dialogs retain editable action arrays', () => {
  const dialog = new Dialog('D', 'C_INFO');
  dialog.actions.push(new Action('Standalone()'));
  const hydrated = Dialog.fromJSON(JSON.parse(JSON.stringify(dialog)), {});
  assert.ok(hydrated.actions[0] instanceof Action);
  assert.equal(hydrated.actions[0].generateCode({}), 'Standalone();');
  hydrated.actions = [new Action('Replacement()')];
  assert.equal(hydrated.actions[0].action, 'Replacement()');
  const info = new DialogFunction('Info', 'void');
  info.actions = [new Action('Linked()')];
  hydrated.properties.information = info;
  assert.strictEqual(hydrated.actions, info.actions);
});

function commentedSource(newline) {
  return `/* dialog A\n original comment interior */
instance A(C_INFO) { condition = Check; information = Info; };
// dialog B
instance B(C_INFO) { condition = Check; information = Info; };
// condition documentation
func int Check() { return TRUE; };
/* information documentation */
func void Info() { Info_AddChoice(A, "Next", Branch); };
// branch documentation
func void Branch() {};
// unrelated documentation
func void Unrelated() {};`.replace(/\n/g, newline);
}

for (const newline of ['\n', '\r\n']) {
  test(`single-dialog and direct declaration exports own leading comments (${JSON.stringify(newline)})`, () => {
    let model = parse(commentedSource(newline));
    const original = commentTokens(commentedSource(newline));
    const expected = [original[0], ...original.slice(2, 5)];
    for (let cycle = 0; cycle < 3; cycle++) {
      model = hydrate(model);
      assert.deepEqual(commentTokens(generator.generateDialog(model.dialogs.A)), [expected[0]]);
      assert.deepEqual(commentTokens(generator.generateFunction(model.functions.Info)), [expected[2]]);
      const output = generator.generateDialogWithFunctions('A', model);
      assert.deepEqual(commentTokens(output), expected);
      assert.deepEqual(functionNames(output), ['Branch', 'Check', 'Info']);
      assert.deepEqual(commentTokens(new SemanticCodeGenerator({ includeComments: false }).generateDialogWithFunctions('A', model)), []);
      model = parse(output);
    }
  });
}

for (const order of ['absent', 'empty', 'partial', 'parsed']) {
  for (const preserveSourceStyle of [false, true]) {
    test(`every whole-model emission path preserves each declaration comment once (${order}, ${preserveSourceStyle})`, () => {
      let model = parse(commentedSource('\n'));
      const expected = commentTokens(commentedSource('\n')).sort();
      const current = new SemanticCodeGenerator({ sectionHeaders: false, preserveSourceStyle });
      for (let cycle = 0; cycle < 3; cycle++) {
        model = hydrate(model);
        if (order === 'absent') delete model.declarationOrder;
        if (order === 'empty') model.declarationOrder = [];
        if (order === 'partial') model.declarationOrder = [{ type: 'function', name: 'Info' }];
        const output = current.generateSemanticModel(model);
        assert.deepEqual(commentTokens(output).sort(), expected);
        assert.deepEqual(functionNames(output), ['Branch', 'Check', 'Info', 'Unrelated']);
        assert.deepEqual(commentTokens(new SemanticCodeGenerator({ includeComments: false }).generateSemanticModel(model)), []);
        model = parse(output);
      }
    });
  }
}
