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


test('mirrors preserved raw actions to dialog when info function is declared before instance', () => {
  const source = `
  func void DIA_Test_Info()
  {
    if (SC_IsRanger == TRUE)
    {
      AI_Output(self, other, "DIA_Test_01");
    };
  };

  instance DIA_Test(C_INFO)
  {
    information = DIA_Test_Info;
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;
  const dialog = model.dialogs.DIA_Test;
  assert.ok(func, 'Info function should be parsed');
  assert.ok(dialog, 'Dialog should be parsed');

  assert.equal(func.actions.length, 1, 'Function should contain one preserved raw action');
  assert.equal(dialog.actions.length, 1, 'Dialog should mirror function raw action even with late mapping');
  assert.equal(dialog.actions[0].action, func.actions[0].action, 'Mirrored dialog action should match function action text');
});
