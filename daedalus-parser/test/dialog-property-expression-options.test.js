const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParser } = require('./helpers');
const {
  parseSemanticModel, deserializeSemanticModel, SemanticCodeGenerator
} = require('../dist/semantic/semantic-visitor-index');

const expressions = ['BASE + 2', 'GetNumber()', 'BASE | MASK', 'values[INDEX]', 'self.nr', '-BASE', '(BASE + 2) * 3'];

for (const expression of expressions) {
  test(`property expression identity is independent of style: ${expression}`, () => {
    const source = `instance DIA_Test(C_INFO) { nr = ${expression}; description = "Hallo Welt"; };`;
    let model = parseSemanticModel(source);
    assert.equal(model.hasErrors, false);
    for (const preserveSourceStyle of [false, true, false]) {
      model = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
      const output = new SemanticCodeGenerator({ preserveSourceStyle }).generateSemanticModel(model);
      const tree = createParser().parse(output);
      assert.equal(tree.rootNode.hasError, false);
      const assignments = tree.rootNode.namedChildren[0].childForFieldName('body').namedChildren;
      assert.equal(assignments[0].childForFieldName('right').text, expression);
      assert.equal(assignments[1].childForFieldName('right').type, 'string');
      assert.equal(assignments[1].childForFieldName('right').text, '"Hallo Welt"');
      model = parseSemanticModel(output);
    }
  });
}

test('edited expressions use current model values with source style disabled', () => {
  const model = deserializeSemanticModel(JSON.parse(JSON.stringify(
    parseSemanticModel('instance DIA_Test(C_INFO) { nr = BASE + 2; permanent = TRUE; };')
  )));
  model.dialogs.DIA_Test.properties.nr = 'OTHER * 4';
  const output = new SemanticCodeGenerator({ preserveSourceStyle: false }).generateSemanticModel(model);
  assert.match(output, /nr\s*=\s*OTHER \* 4;/);
  assert.match(output, /permanent\s*=\s*TRUE;/);
});

// A string literal's quotes are its syntax, not its text: the model holds the
// contents and `propertyLiteralKeys` holds the kind.
const hydrateJSON = model => deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
const generate = model => new SemanticCodeGenerator().generateSemanticModel(model);

test('a string-literal property holds its contents, through parse and JSON', () => {
  for (const [literal, contents] of [['"Hallo du"', 'Hallo du'], ['""', ''], ['"C:\\dir\\"', 'C:\\dir\\']]) {
    const model = parseSemanticModel(`instance DIA_Test(C_INFO) { description = ${literal}; };`);
    for (const candidate of [model, hydrateJSON(model)]) {
      assert.equal(candidate.dialogs.DIA_Test.properties.description, contents);
      assert.ok(candidate.dialogs.DIA_Test.propertyLiteralKeys.includes('description'));
      assert.ok(generate(candidate).includes(`description = ${literal};`), generate(candidate));
    }
  }
});

test('a literal edited to a function name stays a string', () => {
  const model = hydrateJSON(parseSemanticModel(
    'instance DIA_Test(C_INFO) { information = Info; description = "Hallo"; }; func void Info() {};'
  ));
  model.dialogs.DIA_Test.properties.description = 'Info';
  const again = hydrateJSON(model);
  assert.equal(again.dialogs.DIA_Test.properties.description, 'Info');
  assert.match(generate(again), /description\s*=\s*"Info";/);
});

test('a quoted value on a literal key is refused rather than written with doubled quotes', () => {
  const model = parseSemanticModel('instance DIA_Test(C_INFO) { description = "Hallo"; };');
  model.dialogs.DIA_Test.properties.description = '"Hallo';
  assert.throws(() => generate(model), /double quote/);
});

// JSON written before literals were stored as contents carries the token.
const legacyQuoted = (source, mutate = () => {}) => {
  const json = JSON.parse(JSON.stringify(parseSemanticModel(source)));
  for (const dialog of Object.values(json.dialogs)) {
    dialog.properties.description = `"${dialog.properties.description}"`;
    if (dialog.sourceBody) {
      dialog.sourceBody.propertyValues.description = dialog.properties.description;
    }
    mutate(dialog);
  }
  return json;
};

test('legacy JSON with a quoted literal hydrates to its contents', () => {
  for (const mutate of [() => {}, dialog => { delete dialog.propertyLiteralKeys; }]) {
    const model = deserializeSemanticModel(legacyQuoted('instance DIA_Test(C_INFO) { description = "Hallo"; };', mutate));
    assert.equal(model.dialogs.DIA_Test.properties.description, 'Hallo');
    assert.ok(model.dialogs.DIA_Test.propertyLiteralKeys.includes('description'));
    assert.match(generate(model), /description\s*=\s*"Hallo";/);
  }
});

test('a legacy quoted literal naming a function is not linked to it', () => {
  const json = legacyQuoted(
    'instance DIA_Test(C_INFO) { information = Info; description = "Info"; }; func void Info() {};',
    dialog => { delete dialog.propertyLiteralKeys; }
  );
  const model = deserializeSemanticModel(json);
  assert.equal(model.dialogs.DIA_Test.properties.description, 'Info');
  assert.match(generate(model), /description\s*=\s*"Info";/);
});

test('a preserved body with a legacy quoted baseline still generates verbatim', () => {
  const source = 'instance DIA_Test(C_INFO) { description = "Hallo"; if (Flag) { nr = 2; }; };';
  const model = deserializeSemanticModel(legacyQuoted(source));
  assert.ok(model.dialogs.DIA_Test.sourceBody);
  assert.match(generate(model), /description = "Hallo"; if \(Flag\) \{ nr = 2; \};/);
});
