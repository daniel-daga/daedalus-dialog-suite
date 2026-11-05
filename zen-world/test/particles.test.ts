// What a `.PFX` preview reads and draws (level-editor.md §16.45, #410). The
// field names and their meanings come from OpenGothic's `ParticleFx` and
// `PfxBucket::buildSsbo`; the shapes come from the retail script tree's 481
// `C_PARTICLEFX` bodies.

import {
  MAX_PARTICLES_PER_VOB, buildParticleBillboards, particleKey, particleVisualNames, particlesPerVob,
  readParticleEffect, type ParticleEffect, type VobIndex,
} from '../src/scene';

/** A field map as the renderer hands it over: lowercased names, values as written. */
function fields(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
}

/** `INSTANCE TORCH (C_PARTICLEFX)` from the retail `System/PFX/PfxInst.d`. */
const TORCH = fields({
  ppsvalue: '80.000000000;',
  ppsfps: '1.000000000;',
  shptype_s: '"SPHERE";',
  dirmode_s: '"DIR";',
  velavg: '0.100000001;',
  lsppartavg: '350.000000000;',
  visname_s: '"HUMANBURN.TGA";',
  vistexcolorstart_s: '"255 255 255";',
  vistexcolorend_s: '"255 200 200";',
  vissizestart_s: '"5 5";',
  vissizeendscale: '10.000000000;',
  visalphafunc_s: '"ADD";',
  visalphastart: '255.000000000;',
});

function index(vobs: Array<{ visual: string; visualType?: string; pos?: number[] }>): VobIndex {
  const visuals: string[] = [];
  const visualTypes: string[] = [];
  const intern = (dict: string[], value: string) =>
    (dict.includes(value) ? dict.indexOf(value) : dict.push(value) - 1);

  const positions = new Float32Array(vobs.length * 3);
  const visualIndex = new Uint32Array(vobs.length);
  const visualTypeIndex = new Uint32Array(vobs.length);

  vobs.forEach((vob, i) => {
    visualIndex[i] = intern(visuals, vob.visual);
    visualTypeIndex[i] = intern(visualTypes, vob.visualType ?? 'PARTICLE_EFFECT');
    positions.set(vob.pos ?? [i * 100, 0, 0], i * 3);
  });

  return {
    count: vobs.length,
    parent: new Int32Array(vobs.length).fill(-1).buffer,
    childIndex: new Uint32Array(vobs.length).buffer,
    positions: positions.buffer,
    rotations: new Float32Array(vobs.length * 9).buffer,
    flags: new Uint32Array(vobs.length).fill(1).buffer,
    classes: ['zCVob'], classIndex: new Uint32Array(vobs.length).buffer,
    names: [''], nameIndex: new Uint32Array(vobs.length).buffer,
    visuals, visualIndex: visualIndex.buffer,
    visualTypes, visualTypeIndex: visualTypeIndex.buffer,
    decalVobs: new Uint32Array(0).buffer,
    decalDimensions: new Float32Array(0).buffer,
    decalAlphaWeights: new Uint8Array(0).buffer,
    decalAlphaFuncs: new Uint8Array(0).buffer,
  };
}

describe('zen-world/particles — readParticleEffect', () => {
  test('a retail body becomes the effect it draws', () => {
    expect(readParticleEffect('TORCH', TORCH)).toEqual({
      name: 'TORCH',
      texture: 'HUMANBURN.TGA',
      rate: 80,
      lifetimeMs: 350,
      sizeStart: [5, 5],
      sizeEndScale: 10,
      colorStart: [255, 255, 255],
      colorEnd: [255, 200, 200],
      alphaStart: 1,
      alphaEnd: 1,      // absent in the body, and OpenGothic's default is opaque
      additive: true,
    });
  });

  test('a negative rate is a decal-driven effect, and is not previewed', () => {
    // OpenGothic reads `ppsValue < 0` as `isDecal()`: the picture comes from a
    // sprite with the VOB's own material, not from an emitter.
    const definition = { ...TORCH, ppsvalue: '-1;' };
    expect(readParticleEffect('X', definition)).toBeNull();
  });

  test('a definition with no texture draws nothing', () => {
    const definition = { ...TORCH, visname_s: '"=";' };
    expect(readParticleEffect('X', definition)).toBeNull();
  });

  test('an absurd lifetime is clamped to something a preview can step', () => {
    // FBNEW in retail carries lspPartAvg = 6e13: a data error, not a lifetime.
    const effect = readParticleEffect('FBNEW', { ...TORCH, lsppartavg: '60000001100000;' })!;
    expect(effect.lifetimeMs).toBe(20_000);
  });

  test('"=" is the scripts\' "unchanged", so the field falls back', () => {
    const effect = readParticleEffect('X', {
      ...TORCH, vissizeendscale: '"=";', vistexcolorend_s: '"=";', visalphastart: '"=";',
    })!;
    expect(effect.sizeEndScale).toBe(1);
    expect(effect.colorEnd).toEqual([255, 255, 255]);
    expect(effect.alphaStart).toBe(1);
  });

  test('BLEND is not additive, and retail\'s "BLENND" typo is not either', () => {
    expect(readParticleEffect('X', { ...TORCH, visalphafunc_s: '"BLEND";' })!.additive).toBe(false);
    expect(readParticleEffect('X', { ...TORCH, visalphafunc_s: '"BLENND";' })!.additive).toBe(false);
  });

  test('a body with no size still draws: the quad has a floor', () => {
    const effect = readParticleEffect('X', { ...TORCH, vissizestart_s: '"0";' })!;
    expect(effect.sizeStart).toEqual([15, 15]);
  });
});

describe('zen-world/particles — how many particles a VOB carries', () => {
  const effect = (rate: number, lifetimeMs: number): ParticleEffect => ({
    ...(readParticleEffect('X', TORCH)!), rate, lifetimeMs,
  });

  test('is the birth rate times the lifetime', () => {
    // TORCH: 80 particles a second, each alive 350 ms.
    expect(particlesPerVob(readParticleEffect('TORCH', TORCH)!)).toBe(28);
  });

  test('is capped, because retail carries effects of thousands', () => {
    expect(particlesPerVob(effect(2500, 3000))).toBe(MAX_PARTICLES_PER_VOB);
  });

  test('is at least one, so a definition of no rate still shows its texture', () => {
    expect(particlesPerVob(effect(0.001, 1))).toBe(1);
  });
});

describe('zen-world/particles — particleKey', () => {
  test('strips the extension the world carries and uppercases', () => {
    expect(particleKey('Fire.pfx')).toBe('FIRE');
    expect(particleKey('STARGATE')).toBe('STARGATE');
  });
});

describe('zen-world/particles — particleVisualNames', () => {
  test('names every distinct effect, and nothing that is not one', () => {
    const names = particleVisualNames(index([
      { visual: 'FIRE.PFX' },
      { visual: 'FIRE.PFX' },
      { visual: 'TORCH.PFX' },
      { visual: 'SMOKE.PFX', visualType: 'DECAL' },
      { visual: 'BARREL.3DS', visualType: 'MULTI_RESOLUTION_MESH' },
    ]));
    expect(names.sort()).toEqual(['FIRE', 'TORCH']);
  });
});

describe('zen-world/particles — buildParticleBillboards', () => {
  const fire = readParticleEffect('FIRE', TORCH)!;
  const torch = readParticleEffect('TORCH', { ...TORCH, visname_s: '"HUMANBURN.TGA";', ppsvalue: '80;' })!;
  const effects = new Map([['FIRE', fire], ['TORCH', torch]]);

  const world = index([
    { visual: 'FIRE.PFX', pos: [100, 0, 0] },
    { visual: 'FIRE.PFX', pos: [200, 0, 0] },
    { visual: 'TORCH.PFX', pos: [300, 0, 0] },
    { visual: 'STARGATE.PFX', pos: [400, 0, 0] },   // not declared by the project
    { visual: 'SMOKE.PFX', visualType: 'DECAL', pos: [500, 0, 0] },
  ]);

  test('groups the VOBs by effect, and leaves the unresolved ones to their markers', () => {
    const scene = buildParticleBillboards(world, effects);
    expect(scene.stats.effects).toBe(2);
    expect(scene.stats.vobs).toBe(3);

    const fireGroup = scene.groups.find((group) => group.effect.name === 'FIRE')!;
    expect(fireGroup.count).toBe(2);
    expect([...new Uint32Array(fireGroup.vobIds)]).toEqual([0, 1]);
    expect([...new Float32Array(fireGroup.positions)]).toEqual([100, 0, 0, 200, 0, 0]);
    expect(fireGroup.particles).toBe(fireGroup.count * particlesPerVob(fire));
  });

  test('totals the particle instances the layer will draw', () => {
    const scene = buildParticleBillboards(world, effects);
    expect(scene.stats.particles).toBe(
      scene.groups.reduce((total, group) => total + group.particles, 0),
    );
  });

  test('a world meeting no definitions is an empty scene, not an error', () => {
    expect(buildParticleBillboards(world, new Map()).stats).toEqual({ effects: 0, vobs: 0, particles: 0 });
  });
});
