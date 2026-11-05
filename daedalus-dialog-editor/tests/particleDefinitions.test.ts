// Turning a world's particle visual names into the effects they name
// (level-editor.md §16.45, #410). The world holds a name; the definition is a
// `C_PARTICLEFX` instance in script source, which the project index can point at
// and the parser can read — no new IPC, no new parser code.

import { resolveParticleEffects, type ParticleSourceApi } from '../src/renderer/world/particleDefinitions';

const FIRE_BODY = `INSTANCE FIRE (C_PARTICLEFX)
{
     ppsvalue = 25;
     lsppartavg = 1000;
     visname_s = "HUMANBURN.TGA";
     vissizestart_s = "40 40";
     vissizeendscale = 3;
     vistexcolorstart_s = "100 100 100";
     vistexcolorend_s = "100 100 0";
     visalphafunc_s = "ADD";
     visalphastart = 255;
};`;

const TORCH_BODY = `INSTANCE TORCH (C_PARTICLEFX)
{
     ppsvalue = 80;
     lsppartavg = 350;
     visname_s = "HUMANBURN.TGA";
     vissizestart_s = "5 5";
     vissizeendscale = 10;
     visalphafunc_s = "ADD";
};`;

/** A stand-in for the three IPC calls, feeding the instance bodies above. */
function api(files: Record<string, Record<string, string>>): ParticleSourceApi & {
  reads: string[];
  parses: number;
} {
  const reads: string[] = [];
  const state = { reads, parses: 0 };
  return Object.assign(state, {
    // The file's content *is* its path: `parseSource` below turns that back into
    // the bodies this fixture declares, so a read and a parse stay in step.
    async readFile(filePath: string) {
      if (files[filePath] === undefined) throw new Error(`ENOENT ${filePath}`);
      reads.push(filePath);
      return filePath;
    },
    async parseSource(source: string) {
      state.parses += 1;
      const instances: Record<string, { sourceText: string }> = {};
      for (const [name, body] of Object.entries(files[source] ?? {})) {
        instances[name] = { sourceText: body };
      }
      return { instances };
    },
    async extractNpc(sourceText: string) {
      return {
        statements: [...sourceText.matchAll(/^\s*(\w+)\s*=\s*([^;]+);/gm)]
          .map((match) => ({ kind: 'field', field: match[1], value: match[2].trim() })),
      };
    },
  } satisfies ParticleSourceApi);
}

describe('resolveParticleEffects', () => {
  test('reads the instance the index points at into the effect it draws', async () => {
    const effects = await resolveParticleEffects(
      ['FIRE'],
      { FIRE: 'C:/mod/Scripts/System/PFX/PfxInst.d' },
      api({ 'C:/mod/Scripts/System/PFX/PfxInst.d': { FIRE: FIRE_BODY } }),
    );

    expect(effects.get('FIRE')).toEqual({
      name: 'FIRE',
      texture: 'HUMANBURN.TGA',
      rate: 25,
      lifetimeMs: 1000,
      sizeStart: [40, 40],
      sizeEndScale: 3,
      colorStart: [100, 100, 100],
      colorEnd: [100, 100, 0],
      alphaStart: 1,
      alphaEnd: 1,
      additive: true,
    });
  });

  test('reads a file once for the effects it declares', async () => {
    const source = api({ 'a.d': { FIRE: FIRE_BODY, TORCH: TORCH_BODY } });
    const effects = await resolveParticleEffects(['FIRE', 'TORCH'], { FIRE: 'a.d', TORCH: 'a.d' }, source);

    expect(source.reads).toEqual(['a.d']);
    expect(source.parses).toBe(1);
    expect([...effects.keys()].sort()).toEqual(['FIRE', 'TORCH']);
  });

  test('an effect the project does not declare is left to its marker', async () => {
    const effects = await resolveParticleEffects(['STARGATE'], {}, api({}));
    expect(effects.size).toBe(0);
  });

  test('a file that cannot be read does not lose the ones that can', async () => {
    const effects = await resolveParticleEffects(
      ['FIRE', 'TORCH'],
      { FIRE: 'missing.d', TORCH: 'b.d' },
      api({ 'b.d': { TORCH: TORCH_BODY } }),
    );
    expect([...effects.keys()]).toEqual(['TORCH']);
  });

  test('looks the instance up case-insensitively, because Daedalus is', async () => {
    const effects = await resolveParticleEffects(
      ['TORCH'],
      { TORCH: 'a.d' },
      api({ 'a.d': { Torch: TORCH_BODY } }),
    );
    expect(effects.get('TORCH')?.rate).toBe(80);
  });
});
