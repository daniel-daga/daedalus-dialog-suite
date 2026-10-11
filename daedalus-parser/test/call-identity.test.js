const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParser } = require('./helpers');
const {
  parseSemanticModel, deserializeSemanticModel, SemanticCodeGenerator, LogEntry
} = require('../dist/semantic/semantic-visitor-index');

function parse(source) {
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false, JSON.stringify(model.errors));
  return model;
}

function hydrate(model) {
  return deserializeSemanticModel(JSON.parse(JSON.stringify(model)));
}

function callees(source) {
  const root = createParser().parse(source).rootNode;
  assert.equal(root.hasError, false, source);
  return root.descendantsOfType('call_expression').map(node => node.childForFieldName('function').text);
}

const calls = [
  'Log_AddEntry(TOPIC_Test, "entry")',
  'lOg_AdDeNtRy(TOPIC_Test, "entry")',
  'b_logentry(TOPIC_Test, "entry")',
  'ai_output(self, other, "ID")',
  'info_addchoice(D, "choice", Next)',
  'info_clearchoices(D)',
  'log_createtopic(TOPIC_Test, LOG_MISSION)',
  'log_settopicstatus(TOPIC_Test, LOG_RUNNING)',
  'createinvitems(self, Gold, 2)',
  'b_giveinvitems(self, other, Gold, 2)',
  'b_attack(self, other, AR_NONE, 2)',
  'b_setattitude(self, ATT_FRIENDLY)',
  'npc_exchangeroutine(self, "Work")',
  'b_kapitelwechsel(2, WORLD)',
  'ai_stopprocessinfos(self)',
  'npc_setrefusetalk(self, 2)',
  'ai_playani(self, "T_WAVE")',
  'b_giveplayerxp(2)',
  'b_beklauen(self, other)',
  'c_beklauen(1, 2)',
  'b_startotherroutine(self, "Work")',
  'b_teachCustom(self, 2)',
  'b_givetradeinv(self)',
  'npc_removeinvitems(self, Gold, 2)',
  'npc_removeinvitem(self, Gold)',
  'wld_insertnpc(Npc, "WP")',
  'Unknown_Helper(self, 2)'
];

for (const call of calls) {
  test(`parsed action retains its callee independently of comment and style options: ${call}`, () => {
    const expected = call.slice(0, call.indexOf('('));
    for (const suffix of ['', ' /* keep */']) {
      let model = parse(`func void F() { ${call}${suffix}; };`);
      for (let cycle = 0; cycle < 3; cycle++) {
        model = hydrate(model);
        const includeComments = cycle !== 1;
        const generator = new SemanticCodeGenerator({ includeComments, preserveSourceStyle: cycle !== 2 });
        const output = generator.generateSemanticModel(model);
        assert.deepEqual(callees(output), [expected]);
        const direct = model.functions.F.actions[0].generateCode({ includeComments });
        assert.deepEqual(callees(`func void Direct() { ${direct} };`), [expected]);
        model = parse(output);
      }
    }
  });
}

test('editing a log entry updates its arguments without changing the parsed callee', () => {
  const model = hydrate(parse('func void F() { Log_AddEntry(TOPIC_Old, "old"); };'));
  const action = model.functions.F.actions[0];
  action.topic = 'TOPIC_New';
  action.text = 'new';
  for (const includeComments of [true, false]) {
    const output = new SemanticCodeGenerator({ includeComments }).generateSemanticModel(model);
    assert.deepEqual(callees(output), ['Log_AddEntry']);
    const edited = parse(output).functions.F.actions[0];
    assert.equal(edited.topic, 'TOPIC_New');
    assert.equal(edited.text, 'new');
  }
});

test('explicit callee and arity edits remain authoritative', () => {
  const model = hydrate(parse('func void F() { b_teachCustom(/* keep */ self, 1); };'));
  const action = model.functions.F.actions[0];
  action.teachFunctionName = 'B_TeachDifferent';
  action.teachArgs = ['other', '2', '3'];
  for (const includeComments of [true, false]) {
    const output = new SemanticCodeGenerator({ includeComments }).generateSemanticModel(model);
    assert.deepEqual(callees(output), ['B_TeachDifferent']);
    assert.deepEqual(parse(output).functions.F.actions.find(action => action.type === 'TeachAction').teachArgs, ['other', '2', '3']);
  }
});

for (const condition of [
  'npc_knowsinfo(other, D)', '!npc_knowsinfo(other, D)',
  'npc_hasitems(other, Gold) > 1', 'npc_isdead(other)', '!npc_isdead(other)',
  'npc_isdead(other) == FALSE', 'npc_isinstate(other, State)',
  'npc_getdisttowp(other, "WP") < 100', 'npc_gettalentskill(other, Talent) >= 1'
]) {
  test(`structured conditions preserve call identity after edits: ${condition}`, () => {
    let model = parse(`instance D(C_INFO) { condition = Check; }; func int Check() { if (${condition}) { return TRUE; }; };`);
    const expected = callees(`func void Original() { ${condition}; };`);
    for (let cycle = 0; cycle < 3; cycle++) {
      model = hydrate(model);
      const predicate = model.functions.Check.conditions[0];
      predicate.npc = 'hero';
      const output = new SemanticCodeGenerator({ includeComments: cycle !== 1 }).generateSemanticModel(model);
      assert.deepEqual(callees(output), expected);
      model = parse(output);
      assert.equal(model.functions.Check.conditions[0].npc, 'hero');
    }
  });
}

test('new log-entry actions and legacy JSON without source identity keep the default callee', () => {
  const action = new LogEntry('TOPIC_Test', 'entry');
  assert.match(action.generateCode({}), /B_LogEntry/);
  const model = hydrate({ dialogs: {}, functions: { F: {
    name: 'F', returnType: 'void', actions: [action], conditions: []
  } } });
  assert.deepEqual(callees(new SemanticCodeGenerator().generateSemanticModel(model)), ['B_LogEntry']);
});

test('legacy commented action metadata preserves the original callee with comments disabled', () => {
  const json = JSON.parse(JSON.stringify(parse('func void F() { Log_AddEntry(/* keep */ TOPIC_Test, "entry"); };')));
  delete json.functions.F.actions[0].callIdentity;
  json.functions.F.actions[0].sourceCall.name.initialValue = 'B_LogEntry';
  const model = deserializeSemanticModel(json);
  assert.deepEqual(callees(new SemanticCodeGenerator({ includeComments: false }).generateSemanticModel(model)), ['Log_AddEntry']);
});

for (const suffix of ['', ' /* retained */']) {
  for (const includeComments of [true, false]) {
    test(`pickpocket edits survive parse, hydration and generation (${suffix}, ${includeComments})`, () => {
      const model = hydrate(parse(`func void F() { c_beklauen(10, 90)${suffix}; };`));
      const action = model.functions.F.actions[0];
      action.minChance = '30';
      action.maxChance = '70';
      const generator = new SemanticCodeGenerator({ includeComments });
      let output = generator.generateSemanticModel(hydrate(model));
      assert.deepEqual(callees(output), ['c_beklauen']);
      const edited = parse(output).functions.F.actions[0];
      assert.equal(edited.minChance, '30');
      assert.equal(edited.maxChance, '70');
      action.pickpocketMode = 'B_Beklauen';
      output = generator.generateSemanticModel(hydrate(model));
      assert.deepEqual(callees(output), ['B_Beklauen']);
      assert.deepEqual(parse(output).functions.F.actions[0].pickpocketArgs, []);
      if (includeComments && suffix) {
        assert.ok(output.includes('/* retained */'));
      }
    });

    test(`inventory mode edits survive parse, hydration and generation (${suffix}, ${includeComments})`, () => {
      const model = hydrate(parse(`func void F() { npc_removeinvitems(self, Gold, 5)${suffix}; };`));
      model.functions.F.actions[0].removeFunctionName = 'Npc_RemoveInvItem';
      const output = new SemanticCodeGenerator({ includeComments }).generateSemanticModel(hydrate(model));
      assert.deepEqual(callees(output), ['Npc_RemoveInvItem']);
      assert.equal(parse(output).functions.F.actions[0].removeQuantity, undefined);
      if (includeComments && suffix) {
        assert.ok(output.includes('/* retained */'));
      }
    });
  }
}
