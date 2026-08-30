const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseSemanticModel,
  SemanticCodeGenerator,
  CommentAction,
  DialogLine,
  NpcKnowsInfoCondition,
  NpcHasItemsCondition
} = require('../dist/semantic/semantic-visitor-index');

function generate(model) {
  const generator = new SemanticCodeGenerator({
    includeComments: true,
    sectionHeaders: false,
    preserveSourceStyle: true
  });
  return generator.generateSemanticModel(model);
}

test('same-line comment after AI_Output is the subtitle; next-line comment is standalone', () => {
  const source = `func void B_Foo()
{
\tAI_Output (self, other, "DIA_Foo_15_00"); // spoken subtitle
\t// standalone note on its own line
\tAI_StopProcessInfos (self);
};
`;
  const model = parseSemanticModel(source);
  const { actions } = model.functions.B_Foo;

  // First action is the dialog line, carrying the same-line comment as subtitle.
  assert.ok(actions[0] instanceof DialogLine, 'first action is a DialogLine');
  assert.equal(actions[0].inlineComment, true, 'same-line comment is absorbed as subtitle');
  assert.equal(actions[0].text.trim(), 'spoken subtitle');

  // The next-line comment is preserved as a standalone CommentAction, NOT as the
  // subtitle of the AI_Output.
  const commentActions = actions.filter((a) => a instanceof CommentAction);
  assert.equal(commentActions.length, 1, 'exactly one standalone comment action');
  assert.equal(commentActions[0].text, '// standalone note on its own line');

  const generated = generate(model);
  assert.ok(generated.includes('// spoken subtitle'), 'subtitle regenerates inline');
  assert.ok(generated.includes('// standalone note on its own line'), 'standalone comment regenerates');
  // Standalone comment must appear after the AI_Output line and before StopProcessInfos.
  const subtitleIdx = generated.indexOf('// spoken subtitle');
  const standaloneIdx = generated.indexOf('// standalone note on its own line');
  const stopIdx = generated.indexOf('AI_StopProcessInfos');
  assert.ok(subtitleIdx < standaloneIdx && standaloneIdx < stopIdx, 'standalone comment stays in position');
});

test('standalone comments in a raw-mode condition body regenerate in place', () => {
  const source = `func int DIA_Foo_Condition()
{
\t// gate on prior knowledge
\tif (Npc_KnowsInfo (other, DIA_Foo))
\t{
\t\treturn TRUE;
\t};
\treturn FALSE;
};
`;
  const model = parseSemanticModel(source);
  const { actions } = model.functions.DIA_Foo_Condition;

  assert.ok(actions[0] instanceof CommentAction, 'the leading body comment is a CommentAction');
  assert.equal(actions[0].text, '// gate on prior knowledge');

  const generated = generate(model);
  const commentIdx = generated.indexOf('// gate on prior knowledge');
  const ifIdx = generated.indexOf('if (Npc_KnowsInfo');
  const returnFalseIdx = generated.indexOf('return FALSE;');
  assert.ok(commentIdx >= 0, 'comment preserved');
  assert.ok(commentIdx < ifIdx, 'comment stays before the if');
  assert.ok(ifIdx < returnFalseIdx, 'if stays before return FALSE');

  const reparsed = parseSemanticModel(generated);
  assert.equal(reparsed.hasErrors, false, 'generated condition body reparses cleanly');
});

test('C_INFO instance body comments attach to the following property and body end', () => {
  const source = `instance DIA_Test (C_INFO)
{
\tnpc = Some_NPC;
\t// choose the right slot
\tnr = 1;
\tcondition = DIA_Test_Condition; // uses default gate
\t// trailing bookkeeping
};

func int DIA_Test_Condition()
{
\treturn TRUE;
};
`;
  const model = parseSemanticModel(source);
  const dialog = model.dialogs.DIA_Test;

  assert.deepEqual(dialog.propertyLeadingComments.nr, ['// choose the right slot']);
  assert.equal(dialog.propertyTrailingComments.condition, '// uses default gate');
  assert.deepEqual(dialog.trailingBodyComments, ['// trailing bookkeeping']);

  const generated = generate(model);
  assert.ok(generated.includes('// choose the right slot'), 'property leading comment emitted');
  assert.ok(generated.includes('// uses default gate'), 'property trailing comment emitted');
  assert.ok(generated.includes('// trailing bookkeeping'), 'body trailing comment emitted');

  const reparsed = parseSemanticModel(generated);
  assert.equal(reparsed.hasErrors, false, 'generated instance body reparses cleanly');
});

test('end-of-file comments are preserved as file-trailing comments', () => {
  const source = `var int Some_Global;

// end of file note
`;
  const model = parseSemanticModel(source);
  assert.deepEqual(model.trailingComments, ['// end of file note']);

  const generated = generate(model);
  assert.ok(generated.trimEnd().endsWith('// end of file note'), 'EOF comment emitted last');
});

test('a file ending in an EOF comment keeps its final newline (byte fidelity)', () => {
  // The source ends with a trailing newline after the EOF comment. Dropping it
  // makes the generated output byte-different from the original even though it
  // is token-equal — the editor save path (byte-fidelity ratchet) then reports
  // a false gap for otherwise-clean globals-only files. Regenerating must
  // reproduce the source exactly.
  const source = `var int Some_Global;

// end of file note
`;
  const model = parseSemanticModel(source);
  const generated = generate(model);
  assert.equal(generated, source, 'EOF-comment file regenerates byte-identical (final newline preserved)');
});

test('empty void function does not gain an invented TODO placeholder', () => {
  const source = `func void B_Empty()
{
};
`;
  const model = parseSemanticModel(source);
  const generated = generate(model);
  assert.ok(!generated.includes('TODO'), 'no invented TODO placeholder for an empty void function');

  const reparsed = parseSemanticModel(generated);
  assert.equal(reparsed.hasErrors, false, 'empty function still reparses cleanly');
});

// A comment inside an argument list is an extra, not an argument: the three
// call-argument extractors filtered punctuation only, so `/* n */` was collected
// as an argument and shifted every real one out of place (2026-07 4.16).
test('a comment inside an argument list is not collected as an argument', () => {
  const source = `func void B_Foo()
{
\tAI_Output (self, other, /* voice note */ "DIA_Foo_15_00");
};
`;
  const model = parseSemanticModel(source);
  const line = model.functions.B_Foo.actions[0];

  assert.ok(line instanceof DialogLine, 'first action is a DialogLine');
  assert.equal(line.id, 'DIA_Foo_15_00', 'the third argument is still the subtitle id');
  assert.equal(line.idIsExpression, false, 'the id is a string literal, not an expression');
});

test('a comment inside a condition call is not collected as an argument', () => {
  const source = `instance DIA_Foo_Hello(C_INFO)
{
	npc			= SLD_99003_Farim;
	nr			= 1;
	condition	= DIA_Foo_Hello_Condition;
	information	= DIA_Foo_Hello_Info;
	permanent	= FALSE;
	description	= "Hello";
};

func int DIA_Foo_Hello_Condition()
{
	if (Npc_KnowsInfo (other, /* the info */ DIA_Foo_Intro)
		&& Npc_HasItems (other, /* the item */ ItMi_Gold) >= 1)
	{
		return TRUE;
	};
};

func void DIA_Foo_Hello_Info()
{
	AI_StopProcessInfos (self);
};
`;
  const model = parseSemanticModel(source);
  const { conditions } = model.dialogs.DIA_Foo_Hello.properties.condition;

  // parseArguments (Npc_KnowsInfo) and parseRawCallArguments (Npc_HasItems)
  // are separate extractors; both used to shift on an interleaved comment.
  const knowsInfo = conditions.find((c) => c instanceof NpcKnowsInfoCondition);
  assert.ok(knowsInfo, 'the Npc_KnowsInfo condition is recognized');
  assert.equal(knowsInfo.npc, 'other');
  assert.equal(knowsInfo.dialogRef, 'DIA_Foo_Intro');

  const hasItems = conditions.find((c) => c instanceof NpcHasItemsCondition);
  assert.ok(hasItems, 'the Npc_HasItems condition is recognized');
  assert.equal(hasItems.npc, 'other');
  assert.equal(hasItems.item, 'ItMi_Gold');
});
