const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSemanticModel, SemanticCodeGenerator, deserializeSemanticModel,
  collectReachableFunctions, DialogFunction
} = require('../dist/semantic/semantic-visitor-index');

test('external names matching Object members remain references rather than inherited functions', () => {
  const model = parseSemanticModel('instance D(C_INFO) { information = toString; condition = constructor; };');
  assert.equal(model.hasErrors, false);
  assert.equal(model.dialogs.D.properties.information, 'toString');
  const generated = new SemanticCodeGenerator().generateSemanticModel(model);
  assert.ok(generated.includes('toString;'), generated);
  assert.ok(generated.includes('constructor;'), generated);
  assert.deepEqual([...collectReachableFunctions(model, 'toString')], []);
});

test('prototype-named declarations and properties survive parsing, JSON and generation', () => {
  const source = `
    func void __proto__() { Touch(); };
    instance D(C_INFO) { information = __proto__; __proto__ = 1; };
    const int constructor = 1;
    class toString { var int value; };
  `;
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false);
  assert.ok(Object.prototype.hasOwnProperty.call(model.functions, '__proto__'));
  assert.ok(Object.prototype.hasOwnProperty.call(model.dialogs.D.properties, '__proto__'));
  for (const candidate of [model, deserializeSemanticModel(JSON.parse(JSON.stringify(model)))]) {
    const generated = new SemanticCodeGenerator().generateSemanticModel(candidate);
    assert.equal(parseSemanticModel(generated).hasErrors, false, generated);
    assert.ok(generated.includes('func void __proto__()'), generated);
    assert.match(generated, /__proto__\s*=\s*1;/);
  }
});

test('case-insensitive reachability sees functions added or renamed after an earlier lookup', () => {
  const model = parseSemanticModel('func void First() {};');
  assert.deepEqual([...collectReachableFunctions(model, 'first')], ['First']);
  model.functions.Second = new DialogFunction('Second', 'void');
  assert.deepEqual([...collectReachableFunctions(model, 'second')], ['Second']);
  delete model.functions.First;
  model.functions.FIRST = new DialogFunction('FIRST', 'void');
  assert.deepEqual([...collectReachableFunctions(model, 'first')], ['FIRST']);
});
