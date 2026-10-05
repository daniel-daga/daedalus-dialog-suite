const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSemanticModel, deserializeSemanticModel, SemanticCodeGenerator, DialogFunction, Action, HeroFollowsAction
} = require('../dist/semantic/semantic-visitor-index');
const { createParser } = require('./helpers');

const generator = new SemanticCodeGenerator({ sectionHeaders: false });
const hydrate = model => deserializeSemanticModel(JSON.parse(JSON.stringify(model)));

function argumentTokens(source) {
  const tree = createParser().parse(source);
  assert.equal(tree.rootNode.hasError, false, source);
  return tree.rootNode.descendantsOfType('call_expression').map(call =>
    call.childForFieldName('arguments').namedChildren
      .filter(node => node.type !== 'comment').map(node => [node.type, node.text])
  );
}

for (const body of [
  'AI_Output("", "other", "ID");',
  'AI_Output("self", other, OutputId);',
  'AI_PlayAni("hero", "T_RUN");',
  'B_StartOtherRoutine("hero", "START");',
  'Wld_InsertNpc("Npc_Name", "WP_START");',
  'AI_Output(self, other, "C:\\dialog\\id");',
  'Info_AddChoice(D, "", Branch);',
  'Info_AddChoice(D, "Hello\nWorld", Branch);'
]) {
  test(`argument identity survives source, JSON and both exports: ${body}`, () => {
    const source = `instance D(C_INFO) { information = Info; };
func void Info() { ${body} }; func void Branch() {};`;
    const expected = argumentTokens(source);
    let model = parseSemanticModel(source);
    assert.equal(model.hasErrors, false);
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const output of [
        generator.generateSemanticModel(model), generator.generateDialogWithFunctions('D', model)
      ]) {
        assert.deepEqual(argumentTokens(output), expected);
      }
      model = hydrate(model);
    }
  });
}

for (const hydrated of [false, true]) {
  for (const replaceMap of [false, true]) {
    test(`exports and action views resolve current functions (hydrate=${hydrated}, map=${replaceMap})`, () => {
      let model = parseSemanticModel(`instance D(C_INFO) { information = Info; condition = Check; };
instance E(C_INFO) { information = Info; };
func void Info() { Old(); }; func int Check() { return FALSE; };`);
      if (hydrated) {
        model = hydrate(model);
      }
      const info = new DialogFunction('Info', 'void');
      info.actions = [new Action('Fresh()')];
      const check = new DialogFunction('Check', 'int');
      check.actions = [new Action('return TRUE')];
      if (replaceMap) {
        model.functions = { Info: info, Check: check };
      } else {
        model.functions.Info = info;
        model.functions.Check = check;
      }
      assert.strictEqual(model.dialogs.D.actions, info.actions);
      assert.strictEqual(model.dialogs.E.actions, info.actions);
      for (const candidate of [model, hydrate(model)]) {
        for (const output of [
          generator.generateSemanticModel(candidate), generator.generateDialogWithFunctions('D', candidate)
        ]) {
          assert.match(output, /Fresh\(\)/);
          assert.match(output, /return TRUE/);
          assert.doesNotMatch(output, /Old\(\)|return FALSE/);
        }
      }
      delete model.functions.Info;
      delete model.functions.Check;
      assert.deepEqual(model.dialogs.D.actions, []);
      const output = generator.generateDialogWithFunctions('D', model);
      assert.doesNotMatch(output, /func (void Info|int Check)/);
    });
  }
}

for (const [body, field, flag] of [
  ['AI_Output(self, other, "ID");', 'id', 'idIsExpression'],
  ['Info_AddChoice(D, "Next", Branch);', 'text', 'textIsExpression'],
  ['Log_AddEntry(TOPIC, "Entry");', 'text', 'textIsExpression'],
  ['Npc_ExchangeRoutine(self, "START");', 'routine', 'routineIsExpression'],
  ['AI_PlayAni(self, "T_RUN");', 'animationName', 'animationNameIsExpression'],
  ['B_StartOtherRoutine(self, "START");', 'routineName', 'routineNameIsExpression'],
  ['Wld_InsertNpc(NPC, "WP");', 'spawnPoint', 'spawnPointIsExpression']
]) {
  test(`edited literal/expression rendering contract: ${body}`, () => {
    const model = parseSemanticModel(`func void Info() { ${body} };`);
    const action = model.functions.Info.actions[0];
    for (const value of ['', 'IDENTIFIER', 'C:\\path\\file', 'First\nSecond']) {
      action[field] = value;
      const output = generator.generateSemanticModel(hydrate(model));
      const argumentsList = argumentTokens(output)[0];
      assert.ok(argumentsList.some(([type, text]) => type === 'string' && text === `"${value}"`));
    }
    action[field] = 'invalid " contents';
    assert.throws(() => generator.generateSemanticModel(hydrate(model)), /cannot contain a double quote/);
    action[field] = 'STRING_CONSTANT';
    action[flag] = true;
    assert.ok(argumentTokens(generator.generateSemanticModel(hydrate(model)))[0]
      .some(([type, text]) => type === 'identifier' && text === 'STRING_CONSTANT'));
  });
}

test('compound hero-follow actions use the same string rendering contract after hydration', () => {
  const model = parseSemanticModel('func void Info() {};');
  model.functions.Info.actions = [new HeroFollowsAction('C:\\routine\\START')];
  assert.match(generator.generateSemanticModel(hydrate(model)), /"C:\\routine\\START"/);
  model.functions.Info.actions[0].guideRoutine = 'invalid " contents';
  assert.throws(() => generator.generateSemanticModel(hydrate(model)), /cannot contain a double quote/);
});

test('edited literal properties and comparisons reject unrepresentable quotes', () => {
  const model = parseSemanticModel(`instance D(C_INFO) { description = "Description"; condition = Check; };
func int Check() { if (Name == "Hero") { return TRUE; }; };`);
  model.dialogs.D.properties.description = 'invalid " contents';
  assert.throws(() => generator.generateSemanticModel(model), /cannot contain a double quote/);
  model.dialogs.D.properties.description = 'IDENTIFIER';
  assert.match(generator.generateSemanticModel(hydrate(model)), /description\s*=\s*"IDENTIFIER"/);
  model.functions.Check.conditions[0].value = 'invalid " contents';
  assert.throws(() => generator.generateSemanticModel(hydrate(model)), /cannot contain a double quote/);
});
