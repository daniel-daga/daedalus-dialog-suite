const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');

// Direct coverage for the linking pass (pass 2): resolving instance property
// references to function objects, syncing info-function actions onto the
// dialog, capturing choice targets, and degrading gracefully on dangling refs.

test('resolves information/condition properties to the actual function objects (forward references)', () => {
  const source = `
    instance DIA_Test(C_INFO) {
      npc = TEST_NPC;
      nr = 1;
      condition = DIA_Test_Condition;
      information = DIA_Test_Info;
    };

    func int DIA_Test_Condition() { return TRUE; };
    func void DIA_Test_Info() { AI_Output(self, other, "DIA_Test_01"); };
  `;

  const model = parseSemanticModel(source);
  const dialog = model.dialogs.DIA_Test;
  assert.ok(dialog, 'Dialog should be parsed');

  assert.strictEqual(typeof dialog.properties.information, 'object', 'information should link to a function object');
  assert.strictEqual(dialog.properties.information.name, 'DIA_Test_Info');
  assert.strictEqual(typeof dialog.properties.condition, 'object', 'condition should link to a function object');
  assert.strictEqual(dialog.properties.condition.name, 'DIA_Test_Condition');

  // Linking should reference the SAME function instances held in model.functions.
  assert.strictEqual(dialog.properties.information, model.functions.DIA_Test_Info);
  assert.strictEqual(dialog.properties.condition, model.functions.DIA_Test_Condition);
});

test('syncs the info function dialog actions onto the dialog', () => {
  const source = `
    func void DIA_Test_Info() {
      AI_Output(self, other, "DIA_Test_01");
      AI_Output(other, self, "DIA_Test_02");
    };

    instance DIA_Test(C_INFO) {
      npc = TEST_NPC;
      information = DIA_Test_Info;
    };
  `;

  const model = parseSemanticModel(source);
  const dialog = model.dialogs.DIA_Test;
  assert.ok(dialog);
  assert.ok(Array.isArray(dialog.actions), 'dialog.actions should be an array');

  const lines = dialog.actions.filter((a) => a.constructor.name === 'DialogLine');
  assert.strictEqual(lines.length, 2, 'dialog.actions should mirror the info function dialog lines');
});

test('captures the choice target function from Info_AddChoice', () => {
  const source = `
    func void DIA_Test_Info() {
      Info_AddChoice(DIA_Test, "Continue", DIA_Test_Next);
    };
    func void DIA_Test_Next() { AI_StopProcessInfos(self); };
  `;

  const model = parseSemanticModel(source);
  const info = model.functions.DIA_Test_Info;
  assert.ok(info);

  const choice = info.actions.find((a) => a.constructor.name === 'Choice');
  assert.ok(choice, 'Info_AddChoice should produce a Choice action');
  assert.strictEqual(choice.dialogRef, 'DIA_Test');
  assert.strictEqual(choice.targetFunction, 'DIA_Test_Next');
});

test('leaves dangling property references as plain strings without raising syntax errors', () => {
  const source = `
    instance DIA_Bad(C_INFO) {
      npc = TEST_NPC;
      condition = DIA_Does_Not_Exist;
    };
  `;

  const model = parseSemanticModel(source);
  const dialog = model.dialogs.DIA_Bad;
  assert.ok(dialog);

  assert.strictEqual(typeof dialog.properties.condition, 'string', 'unresolved reference should stay a string');
  assert.strictEqual(dialog.properties.condition, 'DIA_Does_Not_Exist');
  assert.ok(!model.hasErrors, 'an unresolved reference is not a syntax error');
});
