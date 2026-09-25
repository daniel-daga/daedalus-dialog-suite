const { test } = require('node:test');
const assert = require('node:assert');
const { extractNpcDefinition, applyNpcEdits } = require('daedalus-parser/npc-definition');
const { parseSemanticModel } = require('../dist/semantic/semantic-visitor-index');

// Retail-shaped: a prototype parent, comments between statements, tab
// alignment, indexed fields, the vanilla helpers and a raw Mdl_* call.
const ONAR = [
  'instance BAU_900_Onar (Npc_Default)',
  '{',
  '\t// ------ NSC ------',
  '\tname \t\t= "Onar";',
  '\tguild \t\t= GIL_BAU;',
  '\tid \t\t\t= 900;',
  '\tvoice \t\t= 14;',
  '\tflags       = NPC_FLAG_IMMORTAL; // never dies',
  '\tnpctype\t\t= NPCTYPE_MAIN;',
  '\taivar[AIV_ToughGuy] = TRUE;',
  '\tattribute[ATR_STRENGTH] = 50;',
  '',
  '\t// ------ Attribute ------',
  '\tB_SetAttributesToChapter (self, 3);',
  '\tfight_tactic\t\t= FAI_HUMAN_STRONG;',
  '\tEquipItem\t\t\t(self, ItMw_1h_Bau_Mace);',
  '\tB_SetNpcVisual \t\t(self, MALE, "Hum_Head_Fatbald", Face_N_Weak_Orry, BodyTex_N, ITAR_Vlk_H);',
  '\tMdl_SetModelFatness\t(self, 2);',
  '\tif (Kapitel >= 2) { level = 3; };',
  '\tdaily_routine \t\t= Rtn_Start_900;',
  '};'
].join('\n');

/** The block of lines that differs between `before` and `after`: what was
 *  removed and what was added in its place. */
function changedLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) { head += 1; }
  let tail = 0;
  while (
    tail < a.length - head && tail < b.length - head
    && a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) { tail += 1; }
  return { removed: a.slice(head, a.length - tail), added: b.slice(head, b.length - tail) };
}

test('extracts field assignments, indexed fields and calls with their values as written', () => {
  const npc = extractNpcDefinition(ONAR);

  assert.equal(npc.name, 'BAU_900_Onar');
  assert.equal(npc.parent, 'Npc_Default');

  const fields = npc.statements.filter((s) => s.kind === 'field');
  assert.deepEqual(
    fields.map((s) => [s.field, s.index, s.value]),
    [
      ['name', undefined, '"Onar"'],
      ['guild', undefined, 'GIL_BAU'],
      ['id', undefined, '900'],
      ['voice', undefined, '14'],
      ['flags', undefined, 'NPC_FLAG_IMMORTAL'],
      ['npctype', undefined, 'NPCTYPE_MAIN'],
      ['aivar', 'AIV_ToughGuy', 'TRUE'],
      ['attribute', 'ATR_STRENGTH', '50'],
      ['fight_tactic', undefined, 'FAI_HUMAN_STRONG'],
      ['daily_routine', undefined, 'Rtn_Start_900']
    ]
  );

  const calls = npc.statements.filter((s) => s.kind === 'call');
  assert.deepEqual(
    calls.map((s) => [s.name, s.args]),
    [
      ['B_SetAttributesToChapter', ['self', '3']],
      ['EquipItem', ['self', 'ItMw_1h_Bau_Mace']],
      ['B_SetNpcVisual', ['self', 'MALE', '"Hum_Head_Fatbald"', 'Face_N_Weak_Orry', 'BodyTex_N', 'ITAR_Vlk_H']],
      ['Mdl_SetModelFatness', ['self', '2']]
    ]
  );
});

test('keeps what it does not recognise as an opaque statement, in source order', () => {
  const npc = extractNpcDefinition(ONAR);
  const other = npc.statements.filter((s) => s.kind === 'other');
  assert.deepEqual(other.map((s) => s.text), ['if (Kapitel >= 2) { level = 3; };']);

  // Comments are not statements; everything else is, in order.
  const kinds = npc.statements.map((s) => s.kind);
  assert.equal(kinds.length, 15);
  assert.equal(kinds[13], 'other');
});

test('every statement range points at its own text in the source', () => {
  const npc = extractNpcDefinition(ONAR);
  for (const s of npc.statements) {
    assert.equal(ONAR.slice(s.range.startIndex, s.range.endIndex), s.text);
  }
});

test('ranges stay right after a non-ASCII character', () => {
  const src = 'instance A (C_Npc)\n{\n\tname = "Gärtner";\n\tlevel = 4;\n};';
  const level = extractNpcDefinition(src).statements[1];
  assert.equal(level.text, 'level = 4;');
  const edited = applyNpcEdits(src, [{ op: 'set', field: 'level', value: '5' }]);
  assert.equal(edited, 'instance A (C_Npc)\n{\n\tname = "Gärtner";\n\tlevel = 5;\n};');
});

test('no edits returns the source byte-identical', () => {
  assert.equal(applyNpcEdits(ONAR, []), ONAR);
});

test('setting an existing field changes exactly its value, alignment and trailing comment kept', () => {
  const edited = applyNpcEdits(ONAR, [
    { op: 'set', field: 'flags', value: '0' }
  ]);
  assert.deepEqual(changedLines(ONAR, edited), {
    removed: ['\tflags       = NPC_FLAG_IMMORTAL; // never dies'],
    added: ['\tflags       = 0; // never dies']
  });
});

test('field and index match case-insensitively, as Daedalus does', () => {
  const edited = applyNpcEdits(ONAR, [
    { op: 'set', field: 'GUILD', value: 'GIL_SLD' },
    { op: 'set', field: 'Attribute', index: 'atr_strength', value: '80' }
  ]);
  assert.deepEqual(changedLines(ONAR, edited).added, [
    '\tguild \t\t= GIL_SLD;',
    '\tid \t\t\t= 900;',
    '\tvoice \t\t= 14;',
    '\tflags       = NPC_FLAG_IMMORTAL; // never dies',
    '\tnpctype\t\t= NPCTYPE_MAIN;',
    '\taivar[AIV_ToughGuy] = TRUE;',
    '\tattribute[ATR_STRENGTH] = 80;'
  ]);
  const npc = extractNpcDefinition(edited);
  assert.equal(npc.statements.find((s) => s.field === 'guild').value, 'GIL_SLD');
  assert.equal(npc.statements.find((s) => s.index === 'ATR_STRENGTH').value, '80');
});

test('adding a missing field inserts one line after the last field, with its indentation', () => {
  const edited = applyNpcEdits(ONAR, [{ op: 'set', field: 'level', value: '25' }]);
  const { removed, added } = changedLines(ONAR, edited);
  assert.deepEqual(removed, []);
  assert.deepEqual(added, ['\tlevel = 25;']);
  assert.ok(edited.includes('\tdaily_routine \t\t= Rtn_Start_900;\n\tlevel = 25;\n};'));
});

test('adding a missing indexed field writes the index', () => {
  const edited = applyNpcEdits(ONAR, [
    { op: 'set', field: 'protection', index: 'PROT_EDGE', value: '100' }
  ]);
  assert.deepEqual(changedLines(ONAR, edited).added, ['\tprotection[PROT_EDGE] = 100;']);
});

test('adding to a body with no fields inserts before the closing brace', () => {
  const src = 'instance A (Npc_Default)\n{\n\tB_GiveNpcTalents (self);\n};';
  const edited = applyNpcEdits(src, [{ op: 'set', field: 'guild', value: 'GIL_NONE' }]);
  assert.equal(edited, 'instance A (Npc_Default)\n{\n\tB_GiveNpcTalents (self);\n\tguild = GIL_NONE;\n};');
});

test('removing a field deletes its whole line, trailing comment included', () => {
  const edited = applyNpcEdits(ONAR, [{ op: 'remove', field: 'flags' }]);
  assert.deepEqual(changedLines(ONAR, edited), {
    removed: ['\tflags       = NPC_FLAG_IMMORTAL; // never dies'],
    added: []
  });
});

test('removing a statement that shares its line deletes only the statement', () => {
  const src = 'instance A (C_Npc)\n{\n\tlevel = 1; guild = GIL_NONE;\n};';
  const edited = applyNpcEdits(src, [{ op: 'remove', field: 'level' }]);
  assert.equal(edited, 'instance A (C_Npc)\n{\n\tguild = GIL_NONE;\n};');
});

test('removing a field that is not there is a no-op', () => {
  assert.equal(applyNpcEdits(ONAR, [{ op: 'remove', field: 'level' }]), ONAR);
});

test('setting a call replaces its arguments only, spacing before the parenthesis kept', () => {
  const edited = applyNpcEdits(ONAR, [{
    op: 'setCall',
    name: 'b_setnpcvisual',
    args: ['self', 'MALE', '"Hum_Head_Bald"', 'Face_N_Normal01', 'BodyTex_N', 'ITAR_Bau_L']
  }]);
  assert.deepEqual(changedLines(ONAR, edited), {
    removed: ['\tB_SetNpcVisual \t\t(self, MALE, "Hum_Head_Fatbald", Face_N_Weak_Orry, BodyTex_N, ITAR_Vlk_H);'],
    added: ['\tB_SetNpcVisual \t\t(self, MALE, "Hum_Head_Bald", Face_N_Normal01, BodyTex_N, ITAR_Bau_L);']
  });
});

test('a call with no arguments is a call, and its arguments can be set', () => {
  const src = 'instance A (Npc_Default)\n{\n\tB_GiveNpcTalents();\n};';
  const [call] = extractNpcDefinition(src).statements;
  assert.equal(call.kind, 'call');
  assert.deepEqual(call.args, []);
  const edited = applyNpcEdits(src, [{ op: 'setCall', name: 'B_GiveNpcTalents', args: ['self'] }]);
  assert.equal(edited, 'instance A (Npc_Default)\n{\n\tB_GiveNpcTalents(self);\n};');
});

test('adding a missing call inserts it after the last statement', () => {
  const edited = applyNpcEdits(ONAR, [
    { op: 'setCall', name: 'Mdl_ApplyOverlayMds', args: ['self', '"Humans_Arrogance.mds"'] }
  ]);
  assert.deepEqual(changedLines(ONAR, edited).added, ['\tMdl_ApplyOverlayMds (self, "Humans_Arrogance.mds");']);
  assert.ok(edited.endsWith('Rtn_Start_900;\n\tMdl_ApplyOverlayMds (self, "Humans_Arrogance.mds");\n};'));
});

test('removing a call deletes its line', () => {
  const edited = applyNpcEdits(ONAR, [{ op: 'removeCall', name: 'EquipItem' }]);
  assert.deepEqual(changedLines(ONAR, edited), {
    removed: ['\tEquipItem\t\t\t(self, ItMw_1h_Bau_Mace);'],
    added: []
  });
});

// Retail calls EquipItem once per weapon, so a call is addressed by which
// occurrence of its name it is, and a second one can be added beside the first.
const ARMED = [
  'instance SLD_800_Lee (Npc_Default)',
  '{',
  '\tEquipItem (self, ItMw_1h_Sld_Sword);',
  '\tEquipItem (self, ItRw_Sld_Bow);',
  '\tdaily_routine = Rtn_Start_800;',
  '};'
].join('\n');

test('setCall and removeCall can address a later occurrence of a repeated call', () => {
  const edited = applyNpcEdits(ARMED, [
    { op: 'setCall', name: 'EquipItem', occurrence: 1, args: ['self', 'ItRw_Crossbow_L_01'] }
  ]);
  assert.deepEqual(changedLines(ARMED, edited), {
    removed: ['\tEquipItem (self, ItRw_Sld_Bow);'],
    added: ['\tEquipItem (self, ItRw_Crossbow_L_01);']
  });

  const removed = applyNpcEdits(ARMED, [{ op: 'removeCall', name: 'equipitem', occurrence: 1 }]);
  assert.deepEqual(changedLines(ARMED, removed), { removed: ['\tEquipItem (self, ItRw_Sld_Bow);'], added: [] });
});

test('an occurrence that does not exist is a no-op for removeCall and an insert for setCall', () => {
  assert.equal(applyNpcEdits(ARMED, [{ op: 'removeCall', name: 'EquipItem', occurrence: 2 }]), ARMED);
  const edited = applyNpcEdits(ARMED, [
    { op: 'setCall', name: 'EquipItem', occurrence: 2, args: ['self', 'ItMw_2h_Sld_Axe'] }
  ]);
  assert.deepEqual(changedLines(ARMED, edited).added, ['\tEquipItem (self, ItMw_2h_Sld_Axe);']);
});

test('addCall always inserts, even when the name is already called', () => {
  const unarmed = ARMED.replace('\tEquipItem (self, ItRw_Sld_Bow);\n', '');
  const edited = applyNpcEdits(unarmed, [{ op: 'addCall', name: 'EquipItem', args: ['self', 'ItRw_Sld_Bow'] }]);
  assert.deepEqual(changedLines(unarmed, edited), { removed: [], added: ['\tEquipItem (self, ItRw_Sld_Bow);'] });
  const calls = extractNpcDefinition(edited).statements.filter((s) => s.kind === 'call');
  assert.deepEqual(calls.map((s) => s.args[1]), ['ItMw_1h_Sld_Sword', 'ItRw_Sld_Bow']);
});

test('addCall goes after the last call of that name, not after the last statement', () => {
  const edited = applyNpcEdits(ARMED, [{ op: 'addCall', name: 'EquipItem', args: ['self', 'ItMw_2h_Sld_Axe'] }]);
  assert.ok(edited.includes(
    'EquipItem (self, ItRw_Sld_Bow);\n\tEquipItem (self, ItMw_2h_Sld_Axe);\n\tdaily_routine'
  ));
});

test('removing one occurrence and editing the next in one call both resolve against the original', () => {
  const edited = applyNpcEdits(ARMED, [
    { op: 'removeCall', name: 'EquipItem', occurrence: 0 },
    { op: 'setCall', name: 'EquipItem', occurrence: 1, args: ['self', 'ItRw_Crossbow_L_01'] }
  ]);
  assert.deepEqual(changedLines(ARMED, edited), {
    removed: ['\tEquipItem (self, ItMw_1h_Sld_Sword);', '\tEquipItem (self, ItRw_Sld_Bow);'],
    added: ['\tEquipItem (self, ItRw_Crossbow_L_01);']
  });
});

test('several edits in one call apply against the original ranges', () => {
  const edited = applyNpcEdits(ONAR, [
    { op: 'set', field: 'voice', value: '9' },
    { op: 'remove', field: 'npctype' },
    { op: 'set', field: 'level', value: '10' },
    { op: 'setCall', name: 'Mdl_SetModelFatness', args: ['self', '0'] }
  ]);
  const npc = extractNpcDefinition(edited);
  const byField = (f) => npc.statements.find((s) => s.kind === 'field' && s.field.toLowerCase() === f);
  assert.equal(byField('voice').value, '9');
  assert.equal(byField('npctype'), undefined);
  assert.equal(byField('level').value, '10');
  assert.deepEqual(npc.statements.find((s) => s.name === 'Mdl_SetModelFatness').args, ['self', '0']);
  // Nothing else moved.
  assert.equal(npc.statements.length, 15);
  assert.ok(edited.includes('\t// ------ Attribute ------\n\tB_SetAttributesToChapter (self, 3);'));
});

test('an edited instance saves through the model: the generator re-emits its sourceText', () => {
  const model = parseSemanticModel(`${ONAR}\n`);
  const instance = model.instances.BAU_900_Onar;
  assert.equal(extractNpcDefinition(instance.sourceText).statements.length, 15);
  instance.sourceText = applyNpcEdits(instance.sourceText, [{ op: 'set', field: 'guild', value: 'GIL_SLD' }]);
  const { SemanticCodeGenerator } = require('../dist/codegen/generator');
  const out = new SemanticCodeGenerator().generateSemanticModel(model);
  assert.ok(out.includes('\tguild \t\t= GIL_SLD;'));
  assert.ok(!out.includes('GIL_BAU'));
});

test('refuses source that is not a single well-formed instance', () => {
  assert.throws(() => extractNpcDefinition('func void X() {};'), /instance/);
  assert.throws(() => extractNpcDefinition('instance A (C_Npc) { name = ; };'), /syntax/i);
});
