const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSemanticModel, SemanticCodeGenerator } = require('../dist/semantic/semantic-visitor-index');

test('non-call expression statements retain their complete expression in source order', () => {
  const statements = ['1 + Compute();', '(Touch());', '!Touch();', 'self.level;'];
  const model = parseSemanticModel(`func void F() { ${statements.join(' ')} };`);
  assert.equal(model.hasErrors, false);
  const generated = new SemanticCodeGenerator().generateFunction(model.functions.F);
  assert.equal(parseSemanticModel(generated).hasErrors, false, generated);
  let lastIndex = -1;
  for (const statement of statements) {
    const index = generated.indexOf(statement);
    assert.ok(index > lastIndex, generated);
    lastIndex = index;
  }
});

test('expression statements in condition functions force preservation of side effects', () => {
  const model = parseSemanticModel(`
    instance D(C_INFO) { condition = Check; };
    func int Check() { !Touch(); if (A) { return TRUE; }; };
  `);
  assert.equal(model.hasErrors, false);
  const generated = new SemanticCodeGenerator().generateFunction(model.functions.Check);
  assert.ok(generated.includes('!Touch();'), generated);
  assert.ok(generated.indexOf('!Touch();') < generated.indexOf('if (A)'), generated);
});

test('call sites include local initializers and the complete body of a raw condition once', () => {
  const source = [
    'instance D(C_INFO) { condition = Check; };',
    'func int Check() {',
    '  var int count = CountItems(GetNpc());',
    '  if (A) { Touch(); return TRUE; };',
    '  return Finish();',
    '};'
  ].join('\n');
  const model = parseSemanticModel(source);
  assert.equal(model.hasErrors, false);
  const func = model.functions.Check;
  assert.deepEqual(func.calls, ['CountItems', 'GetNpc', 'Touch', 'Finish']);
  assert.deepEqual(func.callSites.map(site => site.functionName), func.calls);
  assert.deepEqual(func.callSites.map(site => site.position.startLine), [3, 3, 4, 5]);
  assert.equal(func.callSites[0].args[0].raw, 'GetNpc()');
});

// #384: each of these regenerated differently from its source.
const roundTrip = (source) => new SemanticCodeGenerator().generateSemanticModel(parseSemanticModel(source));

test('an if condition written without enclosing parentheses is written back without them (#384)', () => {
  for (const condition of ['x < 0', '(a) && (b)', '!(a) || (b)']) {
    const source = `func void F()\n{\n\tif ${condition}\n\t{\n\t\tx = 0;\n\t};\n};\n`;
    assert.equal(roundTrip(source), source);
  }
  const parenthesized = 'func void F()\n{\n\tif (x < 0)\n\t{\n\t\tx = 0;\n\t};\n};\n';
  assert.equal(roundTrip(parenthesized), parenthesized);
});

test('a comment keeps its trailing whitespace (#384)', () => {
  const source = 'func void F()\n{\n\t// note \n\tx = 1;\n\tif (x)\n\t{\n\t\t// inner  \n\t\tx = 2;\n\t};\n};\n';
  assert.equal(roundTrip(source), source);
});

test('continuation lines of a multi-line statement keep their source indentation (#384)', () => {
  const source = `func void F()
{
	code = G(a,
	         b);
	G(a,
	  b);
	if (x
	    || y)
	{
		code = G(a,
		         b);
		G(a,
		  b);
	};
};
`;
  assert.equal(roundTrip(source), source);
});

test('#395: a raw if statement written without a trailing semicolon gains none', () => {
  const statement = 'if ( Npc_IsDrawingSpell(slf) == spell ) { return; }';
  const model = parseSemanticModel(`func void F() { ${statement} AI_ReadySpell(slf, spell, 5); };`);
  assert.equal(model.hasErrors, false);
  const generated = new SemanticCodeGenerator().generateFunction(model.functions.F);
  assert.equal(parseSemanticModel(generated).hasErrors, false, generated);
  assert.match(generated, /\{ return; \}\s*\n/, generated);
});

// #395: a structured if keeps the spelling the MDK wrote it in.
for (const statement of [
  'IF (Wasili_XP == FALSE) { B_GivePlayerXP(5); };',
  'if (Kapitel == 1) { B_GivePlayerXP(5); }',
  'if (Kapitel == 1) { B_GivePlayerXP(5); } else { };',
  'if (Kapitel == 1) { B_GivePlayerXP(5); } else { B_GivePlayerXP(1); }'
]) {
  test(`#395: an unedited structured if regenerates in its source spelling: ${statement}`, () => {
    const model = parseSemanticModel(`func void F() { ${statement} AI_StopProcessInfos(self); };`);
    assert.equal(model.hasErrors, false);
    assert.equal(model.functions.F.actions[0].type, 'ConditionalAction');
    const generated = new SemanticCodeGenerator().generateFunction(model.functions.F);
    assert.equal(parseSemanticModel(generated).hasErrors, false, generated);
    const collapse = text => text.replace(/\s+/g, '');
    assert.ok(collapse(generated).includes(`${collapse(statement)}AI_StopProcessInfos`), generated);
  });
}
