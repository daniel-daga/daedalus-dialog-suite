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
      .toEqual(['aivar', 'if (Kapitel >= 2) { level = 3; };']);
  });

  describe('equipment', () => {
    // Retail equips one weapon per EquipItem call; which control a call
    // belongs to is read off its item's prefix.
    const LEE: NpcDefinition = {
      name: 'SLD_800_Lee',
      parent: 'Npc_Default',
      closingBraceIndex: 0,
      statements: [
        call('EquipItem', ['self', 'ItRw_Sld_Bow']),
        call('EquipItem', ['self', 'itmw_1h_sld_sword']),
        call('EquipItem', ['self', 'ItMw_2h_Sld_Axe']),
      ],
    };

    it('reads the first melee and the first ranged weapon', () => {
      const values = formValuesFrom(LEE);
      expect(values.meleeWeapon).toBe('itmw_1h_sld_sword');
      expect(values.rangedWeapon).toBe('ItRw_Sld_Bow');
    });

    it('edits the call a control read, addressed by its occurrence', () => {
      const before = formValuesFrom(LEE);
      expect(editsBetween(LEE, before, { ...before, meleeWeapon: 'ItMw_1h_Sld_Axe' })).toEqual([
        { op: 'setCall', name: 'EquipItem', occurrence: 1, args: ['self', 'ItMw_1h_Sld_Axe'] },
      ]);
      expect(editsBetween(LEE, before, { ...before, rangedWeapon: '' })).toEqual([
        { op: 'removeCall', name: 'EquipItem', occurrence: 0 },
      ]);
    });

    it('adds a call for a weapon the NPC had none of', () => {
      const bare: NpcDefinition = { ...LEE, statements: [call('EquipItem', ['self', 'ItMw_1h_Sld_Sword'])] };
      const before = formValuesFrom(bare);
      expect(before.rangedWeapon).toBe('');
      expect(editsBetween(bare, before, { ...before, rangedWeapon: 'ItRw_Sld_Bow' })).toEqual([
        { op: 'addCall', name: 'EquipItem', args: ['self', 'ItRw_Sld_Bow'] },
      ]);
    });

    it('leaves a second weapon of the same kind to the other statements', () => {
      expect(uncoveredStatements(LEE)).toEqual([LEE.statements[2]]);
    });
  });
});
