const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');

test('non-call expression statements retain their complete expression in source order', () => {
  const statements = ['1 + Compute();', '(Touch());', '!Touch();', 'self.level;'];
  const model = parseSemanticModel(`func void F() { ${statements.join(' ')} };`);
  assert.equal(model.hasErrors, false);
  const generated = new SemanticCodeGenerator().generateFunction(model.functions.F);
  assert.equal(parseSemanticModel(generated).hasErrors, false, generated);
  let lastIndex = -1;
  for (const statement of statements) {
    const index = generated.indexOf(statement);
    assert.ok(index > lastIndex, generated);
    lastIndex = index;
  }
});

test('expression statements in condition functions force preservation of side effects', () => {
  const model = parseSemanticModel(`
    instance D(C_INFO) { condition = Check; };
    func int Check() { !Touch(); if (A) { return TRUE; }; };
  `);
  assert.equal(model.hasErrors, false);
  const generated = new SemanticCodeGenerator().generateFunction(model.functions.Check);
  assert.ok(generated.includes('!Touch();'), generated);
  assert.ok(generated.indexOf('!Touch();') < generated.indexOf('if (A)'), generated);
});

test('call sites include local initializers and the complete body of a raw condition once', () => {
  const source = [
    'instance D(C_INFO) { condition = Check; };',
    'func int Check() {',
    '  var int count = CountItems(GetNpc());',
    '  if (A) { Touch(); return TRUE; };',
    '  return Finish();',
    '};'
  ].join('\n');
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false);
  const func = model.functions.Check;
  assert.deepEqual(func.calls, ['CountItems', 'GetNpc', 'Touch', 'Finish']);
  assert.deepEqual(func.callSites.map(site => site.functionName), func.calls);
  assert.deepEqual(func.callSites.map(site => site.position.startLine), [3, 3, 4, 5]);
  assert.equal(func.callSites[0].args[0].raw, 'GetNpc()');
});
