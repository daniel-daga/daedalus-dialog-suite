const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');

test('preserves AI_Output listener argument during parse and generation', () => {
  const source = `
  func void DIA_Test_Info()
  {
    AI_Output(other, self, "DIA_Test_01");
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;
  assert.ok(func, 'Function should be parsed');

  const dialogLine = func.actions.find(a => a.constructor.name === 'DialogLine');
  assert.ok(dialogLine, 'Should parse AI_Output as DialogLine');
  assert.equal(dialogLine.listener, 'self', 'Listener should be preserved as "self"');

  const generator = new SemanticCodeGenerator({ includeComments: false });
  const code = generator.generateFunction(func);
  assert.ok(code.includes('AI_Output (other, self, "DIA_Test_01");'), 'Generated code should preserve listener');
});

test('does not synthesize AI_Output comment when source has none', () => {
  const source = `
  func void DIA_Test_Info()
  {
    AI_Output(other, self, "DIA_Test_01");
  };
  `;

  const model = parseSemanticModel(source);
  const generator = new SemanticCodeGenerator({ includeComments: true });
  const code = generator.generateFunction(model.functions.DIA_Test_Info);

  assert.ok(code.includes('AI_Output (other, self, "DIA_Test_01");'));
  assert.ok(!code.includes('//DIA_Test_01'), 'Should not add synthetic inline comment');
});
