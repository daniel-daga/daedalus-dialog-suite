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

test('records every call site with its arguments and source position, not just a hardcoded action whitelist', () => {
  const source = `
    func void TA_Smith_Day() {
      Npc_ExchangeRoutine(self, "SMITH");
      AI_GotoWP(self, "FP_SMITH_STAND");
    };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.TA_Smith_Day;
  assert.ok(func);
  assert.ok(Array.isArray(func.callSites), 'a function should carry its call sites, not only calls');
  assert.strictEqual(func.callSites.length, 2);

  const [exchangeRoutine, gotoWp] = func.callSites;
  assert.strictEqual(exchangeRoutine.functionName, 'Npc_ExchangeRoutine');
  assert.deepStrictEqual(
    exchangeRoutine.args.map((a) => a.value),
    ['self', 'SMITH']
  );
  assert.strictEqual(exchangeRoutine.args[1].isString, true);

  assert.strictEqual(gotoWp.functionName, 'AI_GotoWP');
  assert.strictEqual(gotoWp.args[1].value, 'FP_SMITH_STAND');
  // Line 4 (1-indexed) is where AI_GotoWP is called.
  assert.strictEqual(gotoWp.position.startLine, 4);
  assert.ok(gotoWp.position.startColumn > 0);
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

// ---------------------------------------------------------------------------
// Review fixes (docs/plans/parser-review-fixes.md)
// ---------------------------------------------------------------------------

// F1: compound assignment operators must survive the parse → model → codegen roundtrip.
test('preserves compound assignment operators in function bodies', () => {
  const source = `
    instance DIA_Kap(C_INFO) { information = DIA_Kap_Info; };
    func void DIA_Kap_Info() {
      Kapitel += 1;
      Gold -= 50;
    };
  `;

  const model = parseSemanticModel(source);
  const { actions } = model.functions.DIA_Kap_Info;

  assert.strictEqual(actions[0].variableName, 'Kapitel');
  assert.strictEqual(actions[0].operator, '+=');
  assert.strictEqual(actions[0].value, 1);
  assert.strictEqual(actions[1].operator, '-=');
});

// F1: same for assignments nested inside if-blocks (ConditionalAction branch parsing).
test('preserves compound assignment operators inside conditional actions', () => {
  const source = `
    instance DIA_Kap2(C_INFO) { information = DIA_Kap2_Info; };
    func void DIA_Kap2_Info() {
      if (Gold > 0)
      {
        Gold -= 10;
      };
    };
  `;

  const model = parseSemanticModel(source);
  const conditional = model.functions.DIA_Kap2_Info.actions
    .find((a) => a.constructor.name === 'ConditionalAction');
  assert.ok(conditional, 'if-block should parse as ConditionalAction');
  assert.strictEqual(conditional.thenActions[0].operator, '-=');
});

// F3: Daedalus property names are case-insensitive; capitalized Condition/Information
// must link exactly like the lowercase spellings.
test('links capitalized Condition/Information properties (case-insensitive)', () => {
  const source = `
    instance DIA_Caps(C_INFO) {
      Information = DIA_Caps_Info;
      Condition = DIA_Caps_Cond;
    };
    func int DIA_Caps_Cond() { if (Npc_KnowsInfo(other, DIA_Other)) { return TRUE; }; };
    func void DIA_Caps_Info() { AI_Output(self, other, "DIA_Caps_01"); };
  `;

  const model = parseSemanticModel(source);
  const dialog = model.dialogs.DIA_Caps;

  assert.strictEqual(dialog.properties.Information, model.functions.DIA_Caps_Info,
    'Information should link to the live function object');
  assert.strictEqual(model.functions.DIA_Caps_Cond.conditions.length, 1,
    'Condition function should be recognized and its conditions extracted');
  assert.strictEqual(model.functions.DIA_Caps_Cond.conditions[0].type, 'NpcKnowsInfoCondition');
  assert.strictEqual(dialog.actions.length, 1, 'info-function actions should sync onto the dialog');
});

// F7: a condition function declared before its instance must still be analyzed
// as a condition function (no declaration-order dependence).
test('extracts conditions when the condition function precedes its instance', () => {
  const source = `
    func int DIA_Early_Cond() { if (Npc_KnowsInfo(other, DIA_Other)) { return TRUE; }; };
    instance DIA_Early(C_INFO) {
      condition = DIA_Early_Cond;
    };
  `;

  const model = parseSemanticModel(source);
  const cond = model.functions.DIA_Early_Cond;

  assert.strictEqual(cond.conditions.length, 1,
    'conditions should be extracted even when the function precedes the instance');
  assert.strictEqual(cond.conditions[0].type, 'NpcKnowsInfoCondition');
  assert.strictEqual(cond.actions.length, 0, 'body must not be misparsed as actions');
});

test('records call sites nested in if/else bodies, not only a body\'s top-level calls', () => {
  // A chapter-entry function is one `if` after another, so a spawn written
  // inside one used to be invisible to every callSites consumer.
  const source = `
    func void B_Enter_NewWorld() {
      Wld_InsertNpc(VLK_400_Addon_Bauer, "WP1");
      if (Kapitel == 1) {
        Wld_InsertNpc(VLK_401_Addon_Bauer, "WP2");
      } else {
        Wld_InsertItem(ItMi_Gold, "WP3");
      };
      if (Kapitel == 2) {
        if (SC_KnowsAbout == TRUE) {
          Wld_InsertNpc(VLK_402_Addon_Bauer, "WP4");
        };
      };
    };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.B_Enter_NewWorld;
  assert.ok(func);

  const spawns = func.callSites.filter((c) => c.functionName.startsWith('Wld_Insert'));
  assert.deepStrictEqual(
    spawns.map((c) => [c.functionName, c.args[0].value, c.args[1].value]),
    [
      ['Wld_InsertNpc', 'VLK_400_Addon_Bauer', 'WP1'],
      ['Wld_InsertNpc', 'VLK_401_Addon_Bauer', 'WP2'],
      ['Wld_InsertItem', 'ItMi_Gold', 'WP3'],
      ['Wld_InsertNpc', 'VLK_402_Addon_Bauer', 'WP4']
    ],
    'every spawn call reaches callSites in source order, however deeply nested'
  );
  // The nested calls carry their own position, not the enclosing if's.
  assert.strictEqual(spawns[1].position.startLine, 5);
  assert.strictEqual(spawns[3].position.startLine, 11);
  // `calls` follows callSites, so an orphaned-function check sees them too.
  assert.ok(func.calls.includes('Wld_InsertItem'));
});
