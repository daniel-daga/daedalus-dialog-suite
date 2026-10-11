const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');

test('does not emit duplicate Action for call nested in assignment', () => {
  const source = `
  func void DIA_Test_Info()
  {
    npc = Hlp_GetNpc(SLD_99005_Arog);
    AI_Output(self, other, "DIA_Test_01");
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;
  assert.ok(func, 'Function should be parsed');

  assert.equal(func.actions.length, 2, 'Expected SetVariableAction + DialogLine only');
  assert.equal(func.actions[0].constructor.name, 'SetVariableAction');
  assert.equal(func.actions[1].constructor.name, 'DialogLine');

  const duplicateNestedCall = func.actions.find(
    action => action.constructor.name === 'Action' && action.action.includes('Hlp_GetNpc')
  );
  assert.equal(duplicateNestedCall, undefined, 'Nested call inside assignment must not become standalone Action');
});
