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

test('insertion inside a removed anchor line is rejected instead of consuming the new statement', () => {
  const input = 'instance A(C_NPC)\r\n{\r\n\tlevel = 1; // keep\r\n};';
  for (const edits of [
    [{ op: 'remove', field: 'level' }, { op: 'set', field: 'guild', value: 'GIL_NONE' }],
    [{ op: 'set', field: 'guild', value: 'GIL_NONE' }, { op: 'remove', field: 'level' }]
  ]) {
    assert.throws(() => applyNpcEdits(input, edits), /Conflicting NPC edits/);
  }
});

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
