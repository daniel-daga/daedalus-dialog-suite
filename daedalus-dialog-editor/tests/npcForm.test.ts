import { describe, it, expect } from '@jest/globals';
import type { NpcDefinition, NpcStatement } from '../src/shared/types';
import {
  NPC_FORM_FIELDS,
  formValuesFrom,
  editsBetween,
  validateNpcForm,
  uncoveredStatements,
} from '../src/renderer/npc/npcForm';

const range = { startIndex: 0, endIndex: 0 };
const field = (f: string, value: string, index?: string): NpcStatement => ({
  kind: 'field', field: f, index, value, text: '', range, valueRange: range,
});
const call = (name: string, args: string[], text = ''): NpcStatement => ({
  kind: 'call', name, args, text, range, argsRange: range,
});

const ONAR: NpcDefinition = {
  name: 'BAU_900_Onar',
  parent: 'Npc_Default',
  closingBraceIndex: 0,
  statements: [
    field('Name', '"Onar"'),
    field('guild', 'GIL_BAU'),
    field('attribute', '50', 'atr_strength'),
    call('B_SetNpcVisual', ['self', 'MALE', '"Hum_Head_Fatbald"', 'Face_N_Weak_Orry', 'BodyTex_N', 'ITAR_Vlk_H']),
    call('EquipItem', ['self', 'ItMw_1h_Bau_Mace'], 'EquipItem (self, ItMw_1h_Bau_Mace);'),
    field('aivar', 'TRUE', 'AIV_ToughGuy'),
    { kind: 'other', text: 'if (Kapitel >= 2) { level = 3; };', range },
  ],
};

describe('npcForm', () => {
  it('reads each control from its statement, case-insensitively, and leaves absent ones empty', () => {
    const values = formValuesFrom(ONAR);
    expect(values.name).toBe('Onar');
    expect(values.guild).toBe('GIL_BAU');
    expect(values.strength).toBe('50');
    expect(values.level).toBe('');
    expect(values.gender).toBe('MALE');
    expect(values.headMesh).toBe('Hum_Head_Fatbald');
    expect(values.armor).toBe('ITAR_Vlk_H');
  });

  it('has one value per declared control', () => {
    expect(Object.keys(formValuesFrom(ONAR)).sort()).toEqual(NPC_FORM_FIELDS.map((f) => f.key).sort());
  });

  it('turns nothing changed into no edits', () => {
    const values = formValuesFrom(ONAR);
    expect(editsBetween(ONAR, values, { ...values })).toEqual([]);
  });

  it('sets a changed field, adds a new one and removes a cleared one', () => {
    const before = formValuesFrom(ONAR);
    const after = { ...before, guild: 'GIL_SLD', level: '25', strength: '', protectionEdge: '100' };
    expect(editsBetween(ONAR, before, after)).toEqual([
      { op: 'set', field: 'guild', value: 'GIL_SLD' },
      { op: 'set', field: 'level', value: '25' },
      { op: 'remove', field: 'attribute', index: 'ATR_STRENGTH' },
      { op: 'set', field: 'protection', index: 'PROT_EDGE', value: '100' },
    ]);
  });

  it('trims what was typed, and a whitespace-only value counts as cleared', () => {
    const before = formValuesFrom(ONAR);
    expect(editsBetween(ONAR, before, { ...before, guild: '  GIL_SLD ', name: '   ' })).toEqual([
      { op: 'remove', field: 'name' },
      { op: 'set', field: 'guild', value: 'GIL_SLD' },
    ]);
  });

  it('writes a string field as a string literal, and keeps a constant that stood there as a constant', () => {
    const before = formValuesFrom(ONAR);
    expect(editsBetween(ONAR, before, { ...before, name: 'Onar der Grosse' })).toEqual([
      { op: 'set', field: 'name', value: '"Onar der Grosse"' },
    ]);

    const byConstant: NpcDefinition = { ...ONAR, statements: [field('name', 'NAME_Bauer')] };
    const read = formValuesFrom(byConstant);
    expect(read.name).toBe('NAME_Bauer');
    expect(editsBetween(byConstant, read, { ...read, name: 'NAME_Soeldner' })).toEqual([
      { op: 'set', field: 'name', value: 'NAME_Soeldner' },
    ]);
  });

  it('refuses a string field containing a double quote', () => {
    expect(validateNpcForm({ ...formValuesFrom(ONAR), name: 'Say "hi"' })).toMatch(/Name/);
  });

  it('rewrites the whole visual call when one of its arguments changed, keeping the first argument', () => {
    const before = formValuesFrom(ONAR);
    expect(editsBetween(ONAR, before, { ...before, armor: 'ITAR_Sld_M' })).toEqual([
      { op: 'setCall', name: 'B_SetNpcVisual', args: ['self', 'MALE', '"Hum_Head_Fatbald"', 'Face_N_Weak_Orry', 'BodyTex_N', 'ITAR_Sld_M'] },
    ]);
  });

  it('removes the visual call when every visual control is cleared', () => {
    const before = formValuesFrom(ONAR);
    const cleared = { ...before, gender: '', headMesh: '', faceTexture: '', bodyTexture: '', armor: '' };
    expect(editsBetween(ONAR, before, cleared)).toEqual([{ op: 'removeCall', name: 'B_SetNpcVisual' }]);
  });

  it('writes a new visual call with self as its first argument', () => {
    const bare: NpcDefinition = { ...ONAR, statements: [field('name', '"X"')] };
    const before = formValuesFrom(bare);
    const after = {
      ...before, gender: 'FEMALE', headMesh: 'Hum_Head_Babe', faceTexture: 'FaceBabe_N_Anne',
      bodyTexture: 'BodyTexBabe_N', armor: 'NO_ARMOR',
    };
    expect(editsBetween(bare, before, after)).toEqual([
      { op: 'setCall', name: 'B_SetNpcVisual', args: ['self', 'FEMALE', '"Hum_Head_Babe"', 'FaceBabe_N_Anne', 'BodyTexBabe_N', 'NO_ARMOR'] },
    ]);
  });

  it('refuses a partly filled visual, since the call takes all five', () => {
    const before = formValuesFrom(ONAR);
    expect(validateNpcForm({ ...before, armor: '' })).toMatch(/visual/i);
    expect(validateNpcForm(before)).toBeNull();
    expect(validateNpcForm({ ...before, gender: '', headMesh: '', faceTexture: '', bodyTexture: '', armor: '' })).toBeNull();
  });

  it('refuses a value that spans lines', () => {
    const before = formValuesFrom(ONAR);
    expect(validateNpcForm({ ...before, level: '1\n2' })).toMatch(/Level/);
  });

  it('lists the statements no control covers, in source order', () => {
    expect(uncoveredStatements(ONAR).map((s) => s.kind === 'other' ? s.text : s.kind === 'call' ? s.name : s.field))
      .toEqual(['EquipItem', 'aivar', 'if (Kapitel >= 2) { level = 3; };']);
  });
});
