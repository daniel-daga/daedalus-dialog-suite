const { test } = require('node:test');
const assert = require('node:assert');
const { parseSemanticModel, SemanticCodeGenerator, deserializeAction } = require('../dist/semantic/semantic-visitor-index');

test('preserves AI_Output listener argument during parse and generation', () => {
  const source = `
  func void DIA_Test_Info()
  {
    AI_Output(other, self, "DIA_Test_01");
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;
  assert.ok(func, 'Function should be parsed');

  const dialogLine = func.actions.find(a => a.constructor.name === 'DialogLine');
  assert.ok(dialogLine, 'Should parse AI_Output as DialogLine');
  assert.equal(dialogLine.listener, 'self', 'Listener should be preserved as "self"');

  const generator = new SemanticCodeGenerator({ includeComments: false });
  const code = generator.generateFunction(func);
  assert.ok(code.includes('AI_Output (other, self, "DIA_Test_01");'), 'Generated code should preserve listener');
});

test('does not synthesize AI_Output comment when source has none', () => {
  const source = `
  func void DIA_Test_Info()
  {
    AI_Output(other, self, "DIA_Test_01");
  };
  `;

  const model = parseSemanticModel(source);
  const generator = new SemanticCodeGenerator({ includeComments: true });
  const code = generator.generateFunction(model.functions.DIA_Test_Info);

  assert.ok(code.includes('AI_Output (other, self, "DIA_Test_01");'));
  assert.ok(!code.includes('//DIA_Test_01'), 'Should not add synthetic inline comment');
});

// F10 (docs/plans/parser-review-fixes.md): a non-default listener must be
// preserved — generateCode previously recomputed the listener from the speaker,
// so the original test only passed because (other -> self) matched the default.
test('preserves non-default AI_Output listener during parse and generation', () => {
  const source = `
  func void DIA_Test_Info()
  {
    AI_Output(self, hero, "DIA_Test_02");
  };
  `;

  const model = parseSemanticModel(source);
  const func = model.functions.DIA_Test_Info;
  const dialogLine = func.actions.find(a => a.constructor.name === 'DialogLine');
  assert.equal(dialogLine.listener, 'hero');

  const generator = new SemanticCodeGenerator({ includeComments: false });
  const code = generator.generateFunction(func);
  assert.ok(code.includes('AI_Output (self, hero, "DIA_Test_02");'),
    `Generated code should keep the stored listener, got:\n${code}`);
});

// Issue #115: the editor serializes hero dialog lines over IPC as
// { speaker: 'other', text, id } with NO listener field. Deserializing that
// shape must derive listener='self' from the speaker, not leave it at 'other'.
// Previously plainToInstance ran the DialogLine constructor with no args (so
// listener defaulted to 'other' from an undefined speaker) and never corrected
// it once the real speaker 'other' was copied in — emitting other, other.
test('deserializeAction derives listener from speaker when the field is absent (hero line)', () => {
  const heroLine = deserializeAction({ speaker: 'other', text: 'Hallo!', id: 'DIA_Test_Hero_01' });
  assert.equal(heroLine.listener, 'self',
    'Hero line (speaker other) must have listener self after deserialization');

  const generator = new SemanticCodeGenerator({ includeComments: false });
  const code = generator.generateAction(heroLine);
  assert.equal(code, 'AI_Output (other, self, "DIA_Test_Hero_01");',
    `Hero line must generate other, self — not other, other. Got:\n${code}`);
});

test('deserializeAction derives listener from speaker when the field is absent (npc line)', () => {
  const npcLine = deserializeAction({ speaker: 'self', text: 'Servus!', id: 'DIA_Test_Npc_01' });
  assert.equal(npcLine.listener, 'other',
    'NPC line (speaker self) must have listener other after deserialization');
});

test('deserializeAction preserves an explicit listener field', () => {
  const line = deserializeAction({ speaker: 'self', listener: 'hero', text: 'x', id: 'DIA_Test_Explicit_01' });
  assert.equal(line.listener, 'hero', 'Explicit listener must survive deserialization');
});
