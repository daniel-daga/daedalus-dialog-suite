const { test } = require('node:test');
const assert = require('node:assert/strict');
const DaedalusParser = require('../src/core/parser');
const { SemanticModelBuilderVisitor } = require('../dist/semantic/semantic-visitor');
const { deserializeSemanticModel } = require('../dist/semantic/semantic-model');
const { SemanticCodeGenerator } = require('../dist/codegen/generator');

const parser = DaedalusParser.create();
const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false });

function buildModel(body, completeSource = false) {
  const source = completeSource ? body : `func void F() {\n${body}\n};`;
  const result = parser.parse(source);
  assert.equal(result.hasErrors, false, source);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(result.rootNode);
  visitor.pass2_analyzeAndLink(result.rootNode);
  return visitor.semanticModel;
}

function findAction(actions, type) {
  for (const action of actions) {
    if (action.type === type) {
      return action;
    }
    if (action.type === 'ConditionalAction') {
      const found = findAction([...action.thenActions, ...action.elseActions], type);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

const branches = [
  (body) => body,
  (body) => `if (A) { ${body} };`,
  (body) => `if (A) { Run(); } else { ${body} };`,
  (body) => `if (A) { if (B) { ${body} }; };`
];
const actionCases = [
  {
    type: 'CreateInventoryItems',
    body: 'CreateInvItems (self, /* outside */ ItMi_Gold, Amount /* old */ + 1);',
    edit: (action, value) => { action.quantity = value; }
  },
  {
    type: 'TeachAction',
    body: 'B_TeachÄCustom (/* outside */ self, Amount /* old */ + 1);',
    edit: (action, value) => { action.teachArgs[1] = value; }
  }
];
const edits = [
  ['replace inner comment', 'Amount /* new */ + 1', '/* new */'],
  ['delete inner comment', 'Amount + 1', null],
  ['replace complete expression', '5', null],
  ['add leading block comment', '/* new */ 5', '/* new */'],
  ['add trailing block comment', '5 /* new */', '/* new */'],
  ['add inner block comment', 'Amount /* new */ + 2', '/* new */'],
  ['add leading line comment', '// new\n5', '// new'],
  ['add trailing line comment', '5 // new\n', '// new'],
  ['add inner line comment', 'Amount // new\n+ 2', '// new']
];

for (const [label, value, comment] of edits) {
  test(`commented argument edit: ${label}`, () => {
    for (const fixture of actionCases) {
      for (const branch of branches) {
        for (const legacy of [false, true]) {
          let model = buildModel(branch(fixture.body));
          const action = findAction(model.functions.F.actions, fixture.type);
          assert.ok(action);
          if (legacy) {
            delete action.sourceCall;
          }
          fixture.edit(action, value);
          // Exercise the official IPC reconstruction before every generation.
          for (let cycle = 0; cycle < 3; cycle++) {
            model = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
            const output = generator.generateSemanticModel(model);
            assert.ok(output.includes('/* outside */'), output);
            assert.ok(!output.includes('/* old */'), output);
            if (comment) {
              assert.ok(output.includes(comment), output);
            }
            model = buildModel(output, true);
          }
        }
      }
    }
  });
}

test('argument boundary comments survive adjacent edits without duplication', () => {
  const body = 'CreateInvItems (self, /* first */ ItMi_Gold /* second */, // third\n0001 /* fourth */);';
  let model = buildModel(body);
  findAction(model.functions.F.actions, 'CreateInventoryItems').item = 'ItFo_Apple';
  for (let cycle = 0; cycle < 3; cycle++) {
    model = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
    const output = generator.generateSemanticModel(model);
    for (const comment of ['/* first */', '/* second */', '// third', '/* fourth */']) {
      assert.equal(output.split(comment).length - 1, 1, output);
    }
    assert.ok(output.includes('0001'), output);
    model = buildModel(output, true);
    const action = findAction(model.functions.F.actions, 'CreateInventoryItems');
    assert.equal(action.item, 'ItFo_Apple');
    assert.equal(action.quantity, 1);
  }
});

test('structural edits retain distinct outside comments and current argument comments', () => {
  let model = buildModel('B_TeachCustom (/* same */ self, Amount /* inside */ + 1 /* same */);');
  const action = findAction(model.functions.F.actions, 'TeachAction');
  action.teachArgs = ['self', '/* current */ 5', 'other'];
  model = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
  const output = generator.generateSemanticModel(model);
  assert.equal(output.split('/* same */').length - 1, 2, output);
  assert.ok(output.includes('/* current */'), output);
  assert.ok(!output.includes('/* inside */'), output);
  const next = buildModel(output, true);
  assert.deepEqual(findAction(next.functions.F.actions, 'TeachAction').teachArgs, ['self', '5', 'other']);
});

test('AI_Output boundary comments and edited multiline subtitles use current values', () => {
  let model = buildModel('AI_Output (self, /* outside */ other, "ID_01"); //old subtitle');
  const line = findAction(model.functions.F.actions, 'DialogLine');
  Object.assign(line, { speaker: 'hero', id: 'ID_02', text: 'new\nB_GivePlayerXP (100);' });
  model = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
  const output = generator.generateSemanticModel(model);
  assert.ok(output.includes('/* outside */'), output);
  assert.ok(!output.includes('old subtitle'), output);
  assert.ok(output.includes('//B_GivePlayerXP (100);'), output);
  const next = buildModel(output, true);
  assert.equal(next.functions.F.actions.some((action) => action.type === 'GivePlayerXPAction'), false);
  assert.equal(findAction(next.functions.F.actions, 'DialogLine').id, 'ID_02');
});

test('quoted punctuation and non-Latin string contents do not become call boundaries', () => {
  let model = buildModel('Info_AddChoice (DIA_T, /* outside */ "old", Target);');
  const choice = findAction(model.functions.F.actions, 'Choice');
  choice.text = '🙂 (, // /* C:\\';
  const output = generator.generateSemanticModel(deserializeSemanticModel(JSON.parse(JSON.stringify(model))));
  model = buildModel(output, true);
  assert.equal(findAction(model.functions.F.actions, 'Choice').text, choice.text);
  assert.ok(output.includes('/* outside */'), output);
});

test('repeated edits and reverting a field use the original argument baseline', () => {
  const source = actionCases[0].body;
  const model = buildModel(source);
  const action = findAction(model.functions.F.actions, 'CreateInventoryItems');
  action.quantity = 'Amount /* changed */ + 2';
  assert.ok(generator.generateSemanticModel(model).includes('/* changed */'));
  action.quantity = 5;
  const next = generator.generateSemanticModel(model);
  assert.ok(!next.includes('/* old */') && !next.includes('/* changed */'), next);
  action.quantity = 'Amount /* old */ + 1';
  assert.ok(generator.generateSemanticModel(model).includes(source));
});

test('malformed edited calls fail rather than replaying the old argument', () => {
  for (const value of ['5 +', '5 // no closing newline', '5); Touch(); CreateInvItems(self, ItMi_Gold, 1']) {
    const model = buildModel(actionCases[0].body);
    findAction(model.functions.F.actions, 'CreateInventoryItems').quantity = value;
    assert.throws(() => generator.generateSemanticModel(model), /valid single call/);
  }
});
