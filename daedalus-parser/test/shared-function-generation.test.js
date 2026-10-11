const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParser } = require('./helpers');
const { parseSemanticModel, deserializeSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');

const source = `instance DIA_A(C_INFO) { condition = SharedCondition; information = SharedInfo; };
instance DIA_B(C_INFO) { condition = sharedcondition; information = sharedinfo; };
func int SharedCondition() { return TRUE; };
func void SharedInfo() { Info_AddChoice(DIA_A, "weiter", SharedChoice); };
func void SharedChoice() { Info_AddChoice(DIA_B, "zurück", SharedInfo); };
func void Helper() {};`;

function declarations(output) {
  const tree = createParser().parse(output);
  assert.equal(tree.rootNode.hasError, false);
  return tree.rootNode.namedChildren.filter(n => n.type === 'function_declaration')
    .map(n => n.childForFieldName('name').text);
}

for (const order of ['absent', 'empty', 'partial', 'parsed']) {
  test(`shared condition, information and cyclic choice functions are emitted once (${order} order)`, () => {
    const model = deserializeSemanticModel(JSON.parse(JSON.stringify(parseSemanticModel(source))));
    if (order === 'absent') { delete model.declarationOrder; }
    if (order === 'empty') { model.declarationOrder = []; }
    if (order === 'partial') { model.declarationOrder = [{ type: 'function', name: 'SharedInfo' }]; }
    const generator = new SemanticCodeGenerator();
    const output = generator.generateSemanticModel(model);
    assert.deepEqual(declarations(output).sort(), ['Helper', 'SharedChoice', 'SharedCondition', 'SharedInfo']);
    assert.ok(output.indexOf('instance DIA_A') < output.indexOf('instance DIA_B'));
    assert.deepEqual(declarations(generator.generateSemanticModel(model)), declarations(output));
    for (const name of ['DIA_A', 'DIA_B']) {
      assert.deepEqual(declarations(generator.generateDialogWithFunctions(name, model)).sort(),
        ['SharedChoice', 'SharedCondition', 'SharedInfo']);
    }
  });
}

test('emission tracks declaration identity rather than dictionary-key casing', () => {
  for (const order of ['absent', 'partial', 'parsed']) {
    const model = parseSemanticModel(source);
    if (order === 'absent') { delete model.declarationOrder; }
    if (order === 'partial') { model.declarationOrder = [{ type: 'dialog', name: 'DIA_A' }]; }
    model.functions.SHAREDINFO = model.functions.SharedInfo;
    delete model.functions.SharedInfo;
    model.functions.HELPER = model.functions.Helper;
    assert.deepEqual(declarations(new SemanticCodeGenerator().generateSemanticModel(model)).sort(),
      ['Helper', 'SharedChoice', 'SharedCondition', 'SharedInfo']);
  }
});
