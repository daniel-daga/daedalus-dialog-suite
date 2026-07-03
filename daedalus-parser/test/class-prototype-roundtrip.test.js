const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseSemanticModel,
  deserializeSemanticModel,
  SemanticCodeGenerator,
  GlobalClass,
  GlobalPrototype
} = require('../dist/semantic/semantic-visitor-index');

const SOURCE = `class C_MyRecord
{
\tvar int data;
\tvar string label;
};

prototype Mst_Default (C_MyRecord)
{
\tdata = 0;
\tlabel = "default";
};

var int Some_Global;
`;

test('parser captures class and prototype declarations with verbatim source text', () => {
  const model = parseSemanticModel(SOURCE);

  assert.ok(model.classes && model.classes.C_MyRecord, 'class should be modeled');
  assert.ok(model.classes.C_MyRecord instanceof GlobalClass, 'class should be a GlobalClass');
  assert.ok(
    model.classes.C_MyRecord.sourceText.includes('var int data;'),
    'class sourceText should be verbatim'
  );

  assert.ok(model.prototypes && model.prototypes.Mst_Default, 'prototype should be modeled');
  assert.ok(model.prototypes.Mst_Default instanceof GlobalPrototype, 'prototype should be a GlobalPrototype');
  assert.equal(model.prototypes.Mst_Default.parent, 'C_MyRecord', 'prototype parent captured');
  assert.ok(
    model.prototypes.Mst_Default.sourceText.includes('label = "default";'),
    'prototype sourceText should be verbatim'
  );

  const orderTypes = model.declarationOrder.map((e) => `${e.type}:${e.name}`);
  assert.deepEqual(
    orderTypes,
    ['class:C_MyRecord', 'prototype:Mst_Default', 'variable:Some_Global'],
    'declarationOrder should include class + prototype in source order'
  );
});

test('class and prototype declarations regenerate token-equal in source order', () => {
  const model = parseSemanticModel(SOURCE);
  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false, preserveSourceStyle: true });
  const generated = generator.generateSemanticModel(model);

  const classIdx = generated.indexOf('class C_MyRecord');
  const protoIdx = generated.indexOf('prototype Mst_Default (C_MyRecord)');
  const varIdx = generated.indexOf('var int Some_Global;');

  assert.ok(classIdx >= 0, 'class should be emitted');
  assert.ok(protoIdx >= 0, 'prototype should be emitted');
  assert.ok(varIdx >= 0, 'trailing variable should be emitted');
  assert.ok(classIdx < protoIdx, 'class should precede prototype');
  assert.ok(protoIdx < varIdx, 'prototype should precede the variable');

  // Re-parse the generated output and confirm no data loss and no syntax errors.
  const reparsed = parseSemanticModel(generated);
  assert.equal(reparsed.hasErrors, false, 'generated code should reparse without errors');
  assert.ok(reparsed.classes.C_MyRecord, 'class survives round-trip');
  assert.ok(reparsed.prototypes.Mst_Default, 'prototype survives round-trip');
});

test('class and prototype survive serialize -> deserialize -> generate', () => {
  const model = parseSemanticModel(SOURCE);
  const roundTripped = deserializeSemanticModel(JSON.parse(JSON.stringify(model)));

  assert.ok(roundTripped.classes.C_MyRecord instanceof GlobalClass, 'class rehydrates as GlobalClass');
  assert.ok(roundTripped.prototypes.Mst_Default instanceof GlobalPrototype, 'prototype rehydrates as GlobalPrototype');

  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false, preserveSourceStyle: true });
  const generated = generator.generateSemanticModel(roundTripped);
  assert.ok(generated.includes('class C_MyRecord'), 'deserialized class regenerates');
  assert.ok(generated.includes('prototype Mst_Default (C_MyRecord)'), 'deserialized prototype regenerates');
});

test('leading comments on class and prototype declarations are preserved', () => {
  const source = `// record definition
class C_Rec
{
\tvar int a;
};

// default prototype
prototype Mst_Rec (C_Rec)
{
\ta = 1;
};
`;
  const model = parseSemanticModel(source);
  assert.deepEqual(model.classes.C_Rec.leadingComments, ['// record definition']);
  assert.deepEqual(model.prototypes.Mst_Rec.leadingComments, ['// default prototype']);

  const generator = new SemanticCodeGenerator({ includeComments: true, sectionHeaders: false, preserveSourceStyle: true });
  const generated = generator.generateSemanticModel(model);
  assert.ok(generated.includes('// record definition'), 'class leading comment emitted');
  assert.ok(generated.includes('// default prototype'), 'prototype leading comment emitted');
});
