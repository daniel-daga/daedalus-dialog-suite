const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyNpcEdits, extractNpcDefinition } = require('daedalus-parser/npc-definition');

const source = 'instance NPC_Test(C_NPC) { name = "Gärtner"; level = 1; attribute[ATR_HITPOINTS] = 10; EquipItem(self, Sword); };';
const conflicts = [
  [{ op: 'set', field: 'level', value: '2' }, { op: 'set', field: 'LEVEL', value: '100' }],
  [{ op: 'set', field: 'level', value: '2' }, { op: 'remove', field: 'level' }],
  [{ op: 'remove', field: 'level' }, { op: 'remove', field: 'LEVEL' }],
  [{ op: 'set', field: 'guild', value: 'GIL_NONE' }, { op: 'set', field: 'GUILD', value: 'GIL_SLD' }],
  [{ op: 'set', field: 'guild', value: 'GIL_NONE' }, { op: 'remove', field: 'guild' }],
  [{ op: 'set', field: 'attribute', index: 'ATR_HITPOINTS', value: '50' },
    { op: 'set', field: 'ATTRIBUTE', index: 'atr_hitpoints', value: '100' }],
  [{ op: 'setCall', name: 'EquipItem', args: ['self', 'Bow'] },
    { op: 'setCall', name: 'equipitem', occurrence: 0, args: ['self', 'Axe'] }],
  [{ op: 'setCall', name: 'Missing', args: ['1'] }, { op: 'removeCall', name: 'MISSING' }],
  [{ op: 'setCall', name: 'EquipItem', args: ['self', 'Bow'] }, { op: 'removeCall', name: 'EquipItem' }]
];

conflicts.forEach((edits, index) => {
  test(`conflicting original-source edit targets are rejected atomically (${index + 1})`, () => {
    const input = JSON.parse(JSON.stringify(edits));
    assert.throws(() => applyNpcEdits(source, input), /Conflicting NPC edits.*0.*1/);
    assert.deepEqual(input, edits);
    assert.equal(extractNpcDefinition(source).statements[1].value, '1');
  });
});

// #445: the NPC editor has one Save button and sends one batch, so an
// insertion anchored on the last field/statement must not sit on a line the
// same batch removes.
test('an insertion anchored on a statement the batch removes is placed after a kept one', () => {
  const input = 'instance A(C_NPC)\r\n{\r\n\tlevel = 1; // keep\r\n};';
  for (const edits of [
    [{ op: 'remove', field: 'level' }, { op: 'set', field: 'guild', value: 'GIL_NONE' }],
    [{ op: 'set', field: 'guild', value: 'GIL_NONE' }, { op: 'remove', field: 'level' }]
  ]) {
    const output = applyNpcEdits(input, edits);
    assert.deepEqual(extractNpcDefinition(output).statements.map((s) => [s.kind, s.field ?? s.name, s.value]),
      [['field', 'guild', 'GIL_NONE']]);
    assert.equal(output, 'instance A(C_NPC)\r\n{\r\n\tguild = GIL_NONE;\r\n};');
  }
});

// The three batches the review reproduced against the editor's one Save.
const npcWithRoutine = 'INSTANCE BAU_900_Onar (C_NPC)\n{\n\tname = "Onar";\n\tid = 900;\n\tdaily_routine = Rtn_Start_900;\n};\n';
const templateWithoutGuild = 'INSTANCE BAU_899_Old (C_NPC)\n{\n\tname = "Old";\n\tid = 899;\n\tdaily_routine = Rtn_Start_899;\n};\n';

const field = (npc, name) => npc.statements.find((s) => s.kind === 'field' && s.field === name)?.value;

const oneSaveBatches = [
  {
    name: 'clearing the daily routine and filling an empty field',
    source: npcWithRoutine,
    edits: [{ op: 'remove', field: 'daily_routine' }, { op: 'set', field: 'flags', value: '0' }],
    check: (npc) => assert.equal(field(npc, 'flags'), '0')
  },
  {
    name: 'adding a call and clearing the daily routine',
    source: npcWithRoutine,
    edits: [
      { op: 'addCall', name: 'EquipItem', args: ['self', 'ItMw_1h_Bau_Mace'] },
      { op: 'remove', field: 'daily_routine' }
    ],
    check: (npc) => assert.deepEqual(
      npc.statements.filter((s) => s.kind === 'call').map((s) => s.args), [['self', 'ItMw_1h_Bau_Mace']]
    )
  },
  {
    // npcTemplate.ts's copy edits, on a template that has no `guild`.
    name: 'copying a template that lacks guild',
    source: templateWithoutGuild,
    edits: [
      { op: 'set', field: 'name', value: '"Harald"' },
      { op: 'set', field: 'guild', value: 'GIL_BAU' },
      { op: 'set', field: 'id', value: '901' },
      { op: 'remove', field: 'daily_routine' }
    ],
    check: (npc) => assert.deepEqual(
      [field(npc, 'name'), field(npc, 'guild'), field(npc, 'id')], ['"Harald"', 'GIL_BAU', '901']
    )
  }
];

for (const { name, source: batchSource, edits, check } of oneSaveBatches) {
  test(`one batch ${name} saves`, () => {
    const npc = extractNpcDefinition(applyNpcEdits(batchSource, edits));
    assert.equal(field(npc, 'daily_routine'), undefined);
    check(npc);
  });
}

test('nonconflicting replacements use original coordinates despite different lengths and Unicode', () => {
  const edits = [{ op: 'set', field: 'name', value: '"A"' }, { op: 'set', field: 'level', value: '100' }];
  const expected = source.replace('"Gärtner"', '"A"').replace('level = 1;', 'level = 100;');
  assert.equal(applyNpcEdits(source, edits), expected);
  assert.equal(applyNpcEdits(source, [...edits].reverse()), expected);
});

test('independent insertions at the same point retain edit order, including repeated addCall', () => {
  const edits = [
    { op: 'set', field: 'guild', value: 'GIL_NONE' },
    { op: 'set', field: 'voice', value: '1' },
    { op: 'addCall', name: 'EquipItem', args: ['self', 'Bow'] },
    { op: 'addCall', name: 'EquipItem', args: ['self', 'Axe'] }
  ];
  const output = applyNpcEdits(source, edits);
  const npc = extractNpcDefinition(output);
  assert.deepEqual(npc.statements.filter(s => s.kind === 'call').map(s => s.args[1]), ['Sword', 'Bow', 'Axe']);
  assert.ok(output.indexOf('guild = GIL_NONE;') < output.indexOf('voice = 1;'));
});

test('different call occurrences keep original identity when another occurrence is removed', () => {
  const input = 'instance A(C_NPC) { EquipItem(self, Sword); EquipItem(self, Bow); };';
  const output = applyNpcEdits(input, [
    { op: 'removeCall', name: 'EquipItem', occurrence: 0 },
    { op: 'setCall', name: 'equipitem', occurrence: 1, args: ['self', 'Axe'] }
  ]);
  assert.deepEqual(extractNpcDefinition(output).statements.map(s => s.args), [['self', 'Axe']]);
});

test('separate calls provide explicit sequential edits when that is intended', () => {
  const first = applyNpcEdits(source, [{ op: 'set', field: 'level', value: '2' }]);
  assert.equal(applyNpcEdits(first, [{ op: 'set', field: 'level', value: '100' }]), source.replace('level = 1;', 'level = 100;'));
});
