const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParser } = require('./helpers');
const {
  SemanticModelBuilderVisitor, SemanticCodeGenerator, deserializeSemanticModel,
  Action
} = require('../dist/semantic/semantic-visitor-index');

function parse(source) {
  const tree = createParser().parse(source);
  assert.equal(tree.rootNode.hasError, false);
  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);
  return visitor.semanticModel;
}

function hydrate(model) {
  return deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
}

function body(source) {
  return createParser().parse(source).rootNode.namedChildren
    .find(node => node.type === 'instance_declaration').childForFieldName('body').text;
}

const cases = [
  'nr = 1; if (Flag) { nr = 2; }; Touch();',
  'nr = 1; nr += 2; Touch();',
  'nr = 1; nr = 2;',
  'nr = 1; NR = 2;',
  'nr = 1; self.nr = 3; values[0] += 1;',
  'nr /* Kommentar: ä */ = 1;',
  'nr = 1; return;',
  'var int counter; counter = 2;'
];

for (const statements of cases) {
  test(`executable C_INFO body survives JSON and three roundtrips: ${statements}`, () => {
    const source = `instance DIA_Test(C_INFO) {\r\n\t${statements}\r\n};`;
    const originalBody = body(source);
    let model = parse(source);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      model = hydrate(model);
      const output = new SemanticCodeGenerator({ preserveSourceStyle: cycle !== 1, includeComments: cycle !== 1 }).generateSemanticModel(model);
      assert.equal(body(output), originalBody);
      model = parse(output);
    }
  });
}

test('nested and compound assignments never become unconditional properties or function links', () => {
  const model = parse(`func int Wrong() { return FALSE; };
    instance DIA_Test(C_INFO) { nr = 1; if (Flag) { nr = 2; condition = Wrong; }; information += Wrong; };`);
  assert.equal(model.dialogs.DIA_Test.properties.nr, 1);
  assert.equal(model.dialogs.DIA_Test.properties.condition, undefined);
  assert.equal(model.dialogs.DIA_Test.properties.information, undefined);
  assert.equal(model.functions.Wrong.conditions.length, 0);
});

test('plain unique property blocks remain structurally editable', () => {
  const model = hydrate(parse('instance DIA_Test(C_INFO) { // before\n nr = 1; description = "Hallo"; };'));
  assert.equal(model.dialogs.DIA_Test.sourceBody, undefined);
  model.dialogs.DIA_Test.properties.nr = 7;
  assert.match(new SemanticCodeGenerator().generateSemanticModel(model), /nr\s*=\s*7;/);
});

test('different programs with the same property projection retain different source bodies', () => {
  const positive = hydrate(parse('instance DIA_Test(C_INFO) { nr = 1; if (Flag) { nr = 2; }; Touch(); };'));
  const negative = hydrate(parse('instance DIA_Test(C_INFO) { nr = 1; if (!Flag) { nr = 2; }; Other(); };'));
  assert.deepEqual(positive.dialogs.DIA_Test.properties, negative.dialogs.DIA_Test.properties);
  const generator = new SemanticCodeGenerator();
  assert.notEqual(body(generator.generateSemanticModel(positive)), body(generator.generateSemanticModel(negative)));
});

test('invalid preserved-body metadata fails rather than silently reverting to property generation', () => {
  const json = JSON.parse(JSON.stringify(parse('instance DIA_Test(C_INFO) { nr = 1; Touch(); };')));
  delete json.dialogs.DIA_Test.sourceBody.propertyValues;
  assert.throws(() => deserializeSemanticModel(json), /invalid preserved instance body metadata/);
});

for (const mutation of [
  dialog => { dialog.properties.nr = 9; },
  dialog => { delete dialog.properties.nr; },
  dialog => { dialog.properties.description = 'new'; },
  dialog => { dialog.properties.information.name = 'Renamed'; }
]) {
  test('edits to a preserved executable body fail visibly after hydration', () => {
    const model = hydrate(parse('instance DIA_Test(C_INFO) { nr = 1; information = Info; Touch(); }; func void Info() {};'));
    mutation(model.dialogs.DIA_Test);
    for (const options of [{}, { allowPartialModel: true }]) {
      assert.throws(() => new SemanticCodeGenerator(options).generateSemanticModel(model), /DIA_Test.*preserved.*body/i);
    }
  });
}

test('editing linked function actions remains possible without changing the preserved constructor', () => {
  const source = 'instance DIA_Test(C_INFO) { information = Info; Touch(); }; func void Info() {};';
  const model = hydrate(parse(source));
  model.functions.Info.actions.push(new Action('Updated()'));
  const output = new SemanticCodeGenerator().generateSemanticModel(model);
  assert.equal(body(output), body(source));
  assert.match(output, /Updated\(\)/);
});

test('a non-C_INFO constructor cannot classify a dialog condition function', () => {
  const model = parse('func int Helper() { return FALSE; }; instance NPC_Test(C_NPC) { condition = Helper; };');
  assert.equal(model.functions.Helper.actions.length, 1);
});
