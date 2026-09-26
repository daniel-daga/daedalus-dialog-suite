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

const CONSTANTS: Record<string, number> = { NO_ARMOR: -1, BODYTEX_N: 1, FACE_N_WEAK_ORRY: 42 };
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

  it('does not guess what B_SetNpcVisual does when it is the last word on the body', () => {
    const helper = call('B_SetNpcVisual', ['self', 'MALE', '"Hum_Head_Fatbald"', 'Face_N_Weak_Orry', 'BodyTex_N', 'NO_ARMOR']);
    expect(resolveNpcVisual(npc(...EXPLICIT, helper), lookup)).toEqual({
      ok: false,
      reason: 'The visual is set by B_SetNpcVisual, whose body is a script function the preview does not read yet',
    });
    // Engine calls after it overwrite whatever it set, so they are drawable.
    expect(resolveNpcVisual(npc(helper, ...EXPLICIT), lookup).ok).toBe(true);
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
