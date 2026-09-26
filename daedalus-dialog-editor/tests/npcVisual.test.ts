import { describe, it, expect } from '@jest/globals';
import type { NpcDefinition, NpcStatement } from '../src/shared/types';
import { resolveNpcVisual, variantTextureName } from '../src/renderer/npc/npcVisual';

const range = { startIndex: 0, endIndex: 0 };
const call = (name: string, args: string[]): NpcStatement => ({
  kind: 'call', name, args, text: '', range, argsRange: range,
});
const npc = (...statements: NpcStatement[]): NpcDefinition => ({
  name: 'BAU_900_Onar', parent: 'Npc_Default', closingBraceIndex: 0, statements,
});

const CONSTANTS: Record<string, number> = { MALE: 0, FEMALE: 1, NO_ARMOR: -1, BODYTEX_N: 1, FACE_N_WEAK_ORRY: 42 };
const lookup = (name: string) => CONSTANTS[name.toUpperCase()];

const EXPLICIT = [
  call('Mdl_SetVisual', ['self', '"HUMANS.MDS"']),
  call('Mdl_SetVisualBody', ['self', '"hum_body_Naked0"', 'BodyTex_N', '2', '"Hum_Head_Bald"', '12', '0', 'NO_ARMOR']),
];

describe('resolveNpcVisual', () => {
  it('reads the engine calls, resolving constants through the project', () => {
    expect(resolveNpcVisual(npc(...EXPLICIT, call('Mdl_SetModelFatness', ['self', '1.5'])), lookup)).toEqual({
      ok: true,
      visual: {
        model: 'HUMANS.MDS',
        bodyMesh: 'hum_body_Naked0',
        bodyTexture: 1,
        skinColor: 2,
        headMesh: 'Hum_Head_Bald',
        headTexture: 12,
        teethTexture: 0,
        armor: null,
        fatness: 1.5,
        scale: [1, 1, 1],
        notes: [],
      },
    });
  });

  it('keeps the armour instance, and a fatness of 0 when the script sets none', () => {
    const body = call('Mdl_SetVisualBody', ['self', '"hum_body_Naked0"', '0', '0', '"Hum_Head_Bald"', '0', '0', 'ITAR_Vlk_H']);
    const result = resolveNpcVisual(npc(EXPLICIT[0], body), lookup);
    expect(result.ok && result.visual.armor).toBe('ITAR_Vlk_H');
    expect(result.ok && result.visual.fatness).toBe(0);
  });

  it('lets the later call win, as the engine runs them in order', () => {
    const later = call('Mdl_SetVisualBody', ['self', '"Hum_Body_Babe0"', '4', '0', '"Hum_Head_Babe"', '137', '0', 'NO_ARMOR']);
    const result = resolveNpcVisual(npc(...EXPLICIT, later), lookup);
    expect(result.ok && result.visual.bodyMesh).toBe('Hum_Body_Babe0');
  });

  it('says a constant the project does not define is why it cannot draw', () => {
    const body = call('Mdl_SetVisualBody', ['self', '"hum_body_Naked0"', 'BodyTex_Mod', '0', '"Hum_Head_Bald"', '0', '0', 'NO_ARMOR']);
    expect(resolveNpcVisual(npc(EXPLICIT[0], body), lookup))
      .toEqual({ ok: false, reason: 'BodyTex_Mod is not a known integer constant' });
  });

  it('does not read a fatness it cannot evaluate as zero', () => {
    expect(resolveNpcVisual(npc(...EXPLICIT, call('Mdl_SetModelFatness', ['self', 'FAT_ONAR'])), lookup))
      .toEqual({ ok: false, reason: 'FAT_ONAR is not a number literal' });
  });

  it('draws nothing without a model or a body, and says which is missing', () => {
    expect(resolveNpcVisual(npc(EXPLICIT[1]), lookup)).toEqual({ ok: false, reason: 'No Mdl_SetVisual call' });
    expect(resolveNpcVisual(npc(EXPLICIT[0]), lookup)).toEqual({ ok: false, reason: 'No Mdl_SetVisualBody call' });
  });

  it('reads a Mdl_SetModelScale, and is at scale 1 without one', () => {
    const scaled = resolveNpcVisual(npc(...EXPLICIT, call('Mdl_SetModelScale', ['self', '0.9', '1', '1.2'])), lookup);
    expect(scaled.ok && scaled.visual.scale).toEqual([0.9, 1, 1.2]);
    const plain = resolveNpcVisual(npc(...EXPLICIT), lookup);
    expect(plain.ok && plain.visual.scale).toEqual([1, 1, 1]);
    expect(plain.ok && plain.visual.notes).toEqual([]);
  });
});

describe('resolveNpcVisual through retail B_SetNpcVisual', () => {
  const strength = (value: string): NpcStatement => ({
    kind: 'field', field: 'attribute', index: 'ATR_STRENGTH', value, text: '', range, valueRange: range,
  });
  const helper = (gender: string, bodyTex = 'BodyTex_N') =>
    call('B_SetNpcVisual', ['self', gender, '"Hum_Head_Fatbald"', 'Face_N_Weak_Orry', bodyTex, 'ITAR_Vlk_H']);

  it('draws a man on the male naked body with skin and teeth 0', () => {
    const result = resolveNpcVisual(npc(strength('50'), helper('MALE')), lookup);
    expect(result).toEqual({
      ok: true,
      visual: {
        model: 'HUMANS.MDS',
        bodyMesh: 'hum_body_Naked0',
        bodyTexture: 1,
        skinColor: 0,
        headMesh: 'Hum_Head_Fatbald',
        headTexture: 42,
        teethTexture: 0,
        armor: 'ITAR_Vlk_H',
        fatness: 0,
        scale: [1, 1, 1],
        notes: [],
      },
    });
  });

  it('makes a weak man narrow and a strong one broad, by the strength set before the call', () => {
    const weak = resolveNpcVisual(npc(strength('49'), helper('MALE')), lookup);
    expect(weak.ok && weak.visual.scale).toEqual([0.9, 1, 1]);
    const strong = resolveNpcVisual(npc(strength('101'), helper('MALE')), lookup);
    expect(strong.ok && strong.visual.scale).toEqual([1.1, 1, 1]);
    const edge = resolveNpcVisual(npc(strength('100'), helper('MALE')), lookup);
    expect(edge.ok && edge.visual.scale).toEqual([1, 1, 1]);
    // Between 50 and 100 the helper sets no scale, so an earlier one stands.
    const kept = resolveNpcVisual(
      npc(call('Mdl_SetModelScale', ['self', '1', '1.2', '1']), strength('100'), helper('MALE')), lookup);
    expect(kept.ok && kept.visual.scale).toEqual([1, 1.2, 1]);
  });

  it('says so when the strength that sets the width is not known where the helper runs', () => {
    // Set after the call, as the Farim reference warns against — the helper saw
    // whatever strength the prototype left, which a preview cannot know.
    const late = resolveNpcVisual(npc(helper('MALE'), strength('20')), lookup);
    expect(late.ok && late.visual.scale).toEqual([1, 1, 1]);
    expect(late.ok && late.visual.notes).toEqual([
      'Width assumed normal: strength is not a known value where B_SetNpcVisual runs',
    ]);
  });

  it('draws a woman on the female body, moving a male body texture to its female variant', () => {
    const result = resolveNpcVisual(npc(strength('10'), helper('FEMALE')), lookup);
    expect(result.ok && result.visual.bodyMesh).toBe('Hum_Body_Babe0');
    expect(result.ok && result.visual.bodyTexture).toBe(5);
    // No width scaling for women, whatever the strength.
    expect(result.ok && result.visual.scale).toEqual([1, 1, 1]);
    expect(result.ok && result.visual.notes).toEqual([]);

    const own = resolveNpcVisual(npc(helper('FEMALE', '10')), lookup);
    expect(own.ok && own.visual.bodyTexture).toBe(10);
  });

  it('lets engine calls after the helper overwrite what it set', () => {
    const result = resolveNpcVisual(npc(helper('MALE'), ...EXPLICIT, call('Mdl_SetModelScale', ['self', '1', '1', '1'])), lookup);
    expect(result.ok && result.visual.bodyTexture).toBe(1);
    expect(result.ok && result.visual.headMesh).toBe('Hum_Head_Bald');
    expect(result.ok && result.visual.notes).toEqual([]);
  });
});

describe('variantTextureName', () => {
  it('substitutes the variation and colour channels as ZenGin does', () => {
    expect(variantTextureName('HUM_BODY_NAKED_V0_C0.TGA', 1, 2)).toBe('HUM_BODY_NAKED_V1_C2.TGA');
    expect(variantTextureName('Hum_Head_V0_C0', 137, 0)).toBe('Hum_Head_V137_C0');
  });

  it('leaves a texture without those channels alone', () => {
    expect(variantTextureName('HUM_TEETH.TGA', 3, 1)).toBe('HUM_TEETH.TGA');
  });
});
