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
