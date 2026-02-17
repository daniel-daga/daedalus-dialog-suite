const { test } = require('node:test');
const assert = require('node:assert');
const { createParser } = require('./helpers');
const { SemanticModelBuilderVisitor } = require('../dist/semantic/semantic-visitor-index');
const { SemanticCodeGenerator } = require('../dist/codegen/generator');

const parser = createParser();

test('Semantic visitor maps Log_AddEntry calls to LogEntry actions', () => {
  const sourceCode = `
func void DIA_Test_LogAddEntry_Info()
{
\tLog_AddEntry(TOPIC_Test, "Added via Log_AddEntry");
};
`;

  const tree = parser.parse(sourceCode);
  assert.ok(!tree.rootNode.hasError, 'Source should parse without syntax errors');

  const visitor = new SemanticModelBuilderVisitor();
  visitor.pass1_createObjects(tree.rootNode);
  visitor.pass2_analyzeAndLink(tree.rootNode);

  const fn = visitor.semanticModel.functions.DIA_Test_LogAddEntry_Info;
  assert.ok(fn, 'Function should exist in semantic model');
  assert.equal(fn.actions.length, 1, 'Function should contain exactly one action');
  assert.equal(fn.actions[0].type, 'LogEntry', 'Log_AddEntry should map to LogEntry action type');
  assert.equal(fn.actions[0].topic, 'TOPIC_Test');
  assert.equal(fn.actions[0].text, 'Added via Log_AddEntry');
});

test('Log_AddEntry remains semantically stable through code generation round-trip', () => {
  const sourceCode = `
func void DIA_Test_LogRoundtrip_Info()
{
\tLog_AddEntry(TOPIC_Test, "From AddEntry");
\tB_LogEntry(TOPIC_Test, "From B_LogEntry");
};
`;

  const tree1 = parser.parse(sourceCode);
  assert.ok(!tree1.rootNode.hasError, 'Original source should parse without syntax errors');

  const visitor1 = new SemanticModelBuilderVisitor();
  visitor1.pass1_createObjects(tree1.rootNode);
  visitor1.pass2_analyzeAndLink(tree1.rootNode);

  const generator = new SemanticCodeGenerator({ includeComments: false, sectionHeaders: false });
  const generatedCode = generator.generateSemanticModel(visitor1.semanticModel);

  assert.ok(
    generatedCode.includes('B_LogEntry (TOPIC_Test, "From AddEntry");'),
    'Generated code should include normalized B_LogEntry form for Log_AddEntry semantics'
  );

  const tree2 = parser.parse(generatedCode);
  assert.ok(!tree2.rootNode.hasError, 'Generated source should parse without syntax errors');

  const visitor2 = new SemanticModelBuilderVisitor();
  visitor2.pass1_createObjects(tree2.rootNode);
  visitor2.pass2_analyzeAndLink(tree2.rootNode);

  const actions1 = visitor1.semanticModel.functions.DIA_Test_LogRoundtrip_Info.actions;
  const actions2 = visitor2.semanticModel.functions.DIA_Test_LogRoundtrip_Info.actions;

  assert.equal(actions1.length, 2, 'Original semantic model should contain two actions');
  assert.equal(actions2.length, 2, 'Round-tripped semantic model should contain two actions');
  assert.ok(actions1.every((action) => action.type === 'LogEntry'), 'Original actions should be LogEntry');
  assert.ok(actions2.every((action) => action.type === 'LogEntry'), 'Round-tripped actions should be LogEntry');
});
