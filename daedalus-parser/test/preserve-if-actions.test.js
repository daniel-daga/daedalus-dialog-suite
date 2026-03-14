const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');

test('parses supported if statements as structured conditional actions in non-condition functions', () => {
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

  assert.equal(func.actions.length, 1, 'Should store one structured conditional action');
  assert.equal(func.actions[0].constructor.name, 'ConditionalAction', 'Should parse if-statement as ConditionalAction');
  assert.equal(func.actions[0].condition, 'SC_IsRanger == TRUE', 'Structured action should keep the if condition');
  assert.equal(func.actions[0].thenActions.length, 1, 'Then branch should contain inner actions');
  assert.equal(func.actions[0].thenActions[0].constructor.name, 'DialogLine', 'Inner AI_Output should remain a dialog line');
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
