const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');

test('preserves if statements as raw actions in non-condition functions', () => {
  const source = `
  func void DIA_Test_Info()
  {
    if (SC_IsRanger == TRUE)
    {
      AI_Output(self, other, "DIA_Test_01");
    };
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;
  assert.ok(func, 'Function should be parsed');

  assert.equal(func.actions.length, 1, 'Should store one raw action for the if-statement');
  assert.equal(func.actions[0].constructor.name, 'Action', 'Should preserve if-statement as Action');
  assert.ok(func.actions[0].action.includes('if (SC_IsRanger == TRUE)'), 'Action should contain if-statement text');

  const hasDialogLine = func.actions.some(a => a.constructor.name === 'DialogLine');
  assert.equal(hasDialogLine, false, 'Should not flatten inner AI_Output into DialogLine actions');
});
