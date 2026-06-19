// Issue #119 (Npc_SetRefuseTalk) and #123 (Info_ClearChoices):
// parse + code generation round-trip for the two new action types.

const { test } = require('node:test');
const { strict: assert } = require('node:assert');
const DaedalusParser = require('../src/core/parser');
const { SemanticModelBuilderVisitor } = require('../dist/semantic/semantic-visitor');
const { SemanticCodeGenerator } = require('../dist/codegen/generator');
const {
  SetRefuseTalkAction,
  ClearChoicesAction
} = require('../dist/semantic/semantic-model');

function buildModel(source) {
  const parser = new DaedalusParser();
  const result = parser.parse(source);
  assert.equal(result.hasErrors, false, 'Should parse without errors');

  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(result.rootNode);
  visitor.pass2_analyzeAndLink(result.rootNode);
  return visitor.semanticModel;
}

test('Npc_SetRefuseTalk is parsed into SetRefuseTalkAction with target + seconds', () => {
  const model = buildModel(`
    func void DIA_Test_Info() {
        Npc_SetRefuseTalk(self, 300);
    };
  `);

  const func = model.functions['DIA_Test_Info'];
  assert.ok(func, 'Function should be found');

  const action = func.actions.find(a => a.constructor.name === 'SetRefuseTalkAction');
  assert.ok(action, 'Should find SetRefuseTalkAction');
  assert.equal(action.target, 'self', 'target should be self');
  assert.equal(action.seconds, 300, 'seconds should be 300');
});

test('Info_ClearChoices is parsed into ClearChoicesAction with the dialog instance', () => {
  const model = buildModel(`
    func void DIA_Test_Info() {
        Info_ClearChoices(DIA_Test_Hi);
    };
  `);

  const func = model.functions['DIA_Test_Info'];
  const action = func.actions.find(a => a.constructor.name === 'ClearChoicesAction');
  assert.ok(action, 'Should find ClearChoicesAction');
  assert.equal(action.dialog, 'DIA_Test_Hi', 'dialog should be DIA_Test_Hi');
});

test('SetRefuseTalkAction.generateCode emits Npc_SetRefuseTalk', () => {
  const generator = new SemanticCodeGenerator();
  const action = new SetRefuseTalkAction('self', 300);
  assert.equal(generator.generateAction(action), 'Npc_SetRefuseTalk (self, 300);');
});

test('ClearChoicesAction.generateCode emits Info_ClearChoices', () => {
  const generator = new SemanticCodeGenerator();
  const action = new ClearChoicesAction('DIA_Test_Hi');
  assert.equal(generator.generateAction(action), 'Info_ClearChoices (DIA_Test_Hi);');
});

test('both actions round-trip through parse -> codegen', () => {
  const model = buildModel(`
    func void DIA_Test_Info() {
        Npc_SetRefuseTalk(self, 120);
        Info_ClearChoices(DIA_Test_Hi);
    };
  `);

  const generator = new SemanticCodeGenerator();
  const { actions } = model.functions['DIA_Test_Info'];
  const emitted = actions.map(a => generator.generateAction(a));

  assert.ok(emitted.includes('Npc_SetRefuseTalk (self, 120);'), 'emits Npc_SetRefuseTalk');
  assert.ok(emitted.includes('Info_ClearChoices (DIA_Test_Hi);'), 'emits Info_ClearChoices');
});
