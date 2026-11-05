// A particle effect is a Daedalus instance, not a file (level-editor.md §16.45,
// #410). The world carries a name; the definition — `INSTANCE X (C_PARTICLEFX)`
// — sits in script source, so a preview starts by reading its fields.
//
// The reading is deliberately narrow: the fields below are the groups
// OpenGothic's `ParticleFx`/`PfxBucket::buildSsbo` actually animate, measured
// against the 481 `C_PARTICLEFX` bodies the retail script tree carries. No
// emitter volume, no direction, no physics, no `zCEffect` chaining — a
// plausible picture of a definition, not the engine's particle system.

import type { VobIndex } from './buildScene';

/** What the preview draws of one `C_PARTICLEFX` instance. */
export interface ParticleEffect {
  /** The instance name, as the scripts declare it. */
  name: string;
  /** `visName_s` — the `.TGA` the billboard is textured with, through the
   *  scene's ordinary texture slots. */
  texture: string;
  /** `ppsValue` — particles born per second. */
  rate: number;
  /** `lspPartAvg` — one particle's life, milliseconds. Clamped: retail carries
   *  values up to 6e13, which is not a lifetime any preview can step. */
  lifetimeMs: number;
  /** `visSizeStart_s` — the quad's size at birth, ZenGin centimetres. */
  sizeStart: [number, number];
  /** `visSizeEndScale` — the birth size's multiplier at death. */
  sizeEndScale: number;
  /** `visTexColorStart_s` / `visTexColorEnd_s`, 0-255 as the scripts write them. */
  colorStart: [number, number, number];
  colorEnd: [number, number, number];
  /** `visAlphaStart` / `visAlphaEnd`, divided to 0-1. */
  alphaStart: number;
  alphaEnd: number;
  /** `visAlphaFunc_s === "ADD"`, which is what OpenGothic premultiplies. */
  additive: boolean;
}

/**
 * How many particles one VOB carries at most. Retail's median effect holds 75
 * live particles and its heavy ones thousands (`MFX_WATERFIST_COLLIDE2` 2,500
 * pps x 3 s), so the count is capped — the picture stays plausible and a world
 * of 600 particle VOBs stays under ~40k instances.
 */
export const MAX_PARTICLES_PER_VOB = 64;

/** A name as both the world and the scripts may spell it: uppercased, and with
 *  the `.PFX` extension the world usually carries stripped — OpenGothic strips
 *  it before looking the instance up, and the world and the script disagree. */
export function particleKey(name: string): string {
  return name.replace(/\.pfx$/i, '').toUpperCase();
}

/** How many particles one VOB's effect holds alive on average: the birth rate
 *  times the lifetime, as OpenGothic's emitter sizes itself. */
export function particlesPerVob(effect: ParticleEffect): number {
  const alive = Math.round((effect.rate * effect.lifetimeMs) / 1000);
  return Math.max(1, Math.min(MAX_PARTICLES_PER_VOB, alive));
}

/** The expression a field assigns: quotes, and the `;` of a whole statement
 *  read elsewhere, are not part of the value. */
const unquote = (value: string): string => {
  const trimmed = value.trim().replace(/;$/, '').trim();
  const quoted = /^"(.*)"$/.exec(trimmed);
  return (quoted ? quoted[1] : trimmed).trim();
};

/** Number in a field, or `fallback`. `"="` is the scripts' "unchanged" and is
 *  as absent as a missing field here. */
function numberIn(
  fields: Readonly<Record<string, string>>, key: string, fallback: number,
): number {
  const raw = fields[key];
  if (raw === undefined) return fallback;
  const value = unquote(raw);
  if (value === '' || value === '=') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A whitespace-separated vector in a field, or `fallback`. */
function vectorIn(
  fields: Readonly<Record<string, string>>, key: string, fallback: readonly number[],
): number[] {
  const raw = fields[key];
  if (raw === undefined) return [...fallback];
  const parts = unquote(raw).split(/[\s,]+/).map(Number.parseFloat).filter(Number.isFinite);
  return parts.length === 0 ? [...fallback] : parts;
}

/** The texture a definition names, or null where it names none (`"="`). */
function textureIn(fields: Readonly<Record<string, string>>): string | null {
  const raw = fields.visname_s;
  if (raw === undefined) return null;
  const value = unquote(raw);
  return value === '' || value === '=' ? null : value;
}

/**
 * One `C_PARTICLEFX` body's fields as a drawable effect, or null where there is
 * nothing to draw: a definition with no texture, and one whose `ppsValue` is
 * negative — OpenGothic reads a negative rate as *this is a decal*, which is
 * the `zCPFXController`-driven half this preview does not take on.
 *
 * `fields` is keyed by lowercased field name, values as written.
 */
export function readParticleEffect(
  name: string, fields: Readonly<Record<string, string>>,
): ParticleEffect | null {
  const texture = textureIn(fields);
  if (texture === null) return null;

  const rate = numberIn(fields, 'ppsvalue', -1);
  if (!(rate > 0)) return null;

  // A particle that never dies cannot be phased; 20 s is already far past what
  // a preview can show, and retail's absurd values are data errors.
  const lifetimeMs = Math.min(20_000, Math.max(1, numberIn(fields, 'lsppartavg', 1000)));

  const size = vectorIn(fields, 'vissizestart_s', []);
  const width = size[0] > 0 ? size[0] : 15;
  const height = (size[1] ?? width) > 0 ? (size[1] ?? width) : width;
  const sizeEndScale = Math.max(0, numberIn(fields, 'vissizeendscale', 1));

  const colorStart = vectorIn(fields, 'vistexcolorstart_s', [255, 255, 255]);
  const colorEnd = vectorIn(fields, 'vistexcolorend_s', [255, 255, 255]);
  const rgb = (values: number[]) => [
    values[0] ?? 255, values[1] ?? 255, values[2] ?? 255,
  ] as [number, number, number];

  const alpha = (key: string) => Math.min(1, Math.max(0, numberIn(fields, key, 255) / 255));

  return {
    name,
    texture,
    rate,
    lifetimeMs,
    sizeStart: [width, height],
    sizeEndScale,
    colorStart: rgb(colorStart),
    colorEnd: rgb(colorEnd),
    alphaStart: alpha('visalphastart'),
    alphaEnd: alpha('visalphaend'),
    additive: (fields.visalphafunc_s ?? '').toUpperCase().includes('ADD'),
  };
}

/** One effect's VOBs, as the layer expands them: each VOB carries
 *  `particlesPerVob(effect)` particles. */
export interface ParticleVobGroup {
  effect: ParticleEffect;
  /** How many VOBs draw this effect. */
  count: number;
  /** How many particle instances those VOBs become. */
  particles: number;
  /** Float32 x3 per VOB — ZenGin space, unconverted like every payload here. */
  positions: ArrayBuffer;
  /** Uint32 x1 per VOB — which VOB each group of particles is, for the pick,
   *  the gizmo and the class filter. */
  vobIds: ArrayBuffer;
}

export interface ParticleScene {
  groups: ParticleVobGroup[];
  stats: {
    /** Effects the project resolved. */
    effects: number;
    /** VOBs the preview draws. */
    vobs: number;
    /** Particle instances those VOBs became. */
    particles: number;
  };
}

/** The distinct effects a world's particle VOBs name, keyed as
 *  `particleKey` — what the renderer looks up in the project index. */
export function particleVisualNames(index: VobIndex): string[] {
  const visualTypes = new Uint32Array(index.visualTypeIndex);
  const visualIndex = new Uint32Array(index.visualIndex);
  const names = new Set<string>();
  for (let vob = 0; vob < index.count; vob++) {
    if (index.visualTypes[visualTypes[vob]] !== 'PARTICLE_EFFECT') continue;
    const name = index.visuals[visualIndex[vob]];
    if (name !== '') names.add(particleKey(name));
  }
  return [...names];
}

/**
 * The particle VOBs the project resolved, grouped by effect.
 *
 * A VOB whose effect the project does not declare stays out — it keeps the
 * marker it has today, exactly as an unresolved `.3DS` does. Nothing here reads
 * or writes the world: the preview is of a definition, not an edit of one.
 */
export function buildParticleBillboards(
  index: VobIndex, effects: ReadonlyMap<string, ParticleEffect>,
): ParticleScene {
  const visualTypes = new Uint32Array(index.visualTypeIndex);
  const visualIndex = new Uint32Array(index.visualIndex);
  const positions = new Float32Array(index.positions);

  const byEffect = new Map<string, { effect: ParticleEffect; positions: number[]; vobIds: number[] }>();
  let vobs = 0;

  for (let vob = 0; vob < index.count; vob++) {
    if (index.visualTypes[visualTypes[vob]] !== 'PARTICLE_EFFECT') continue;
    const key = particleKey(index.visuals[visualIndex[vob]]);
    const effect = effects.get(key);
    if (effect === undefined) continue;

    let group = byEffect.get(key);
    if (group === undefined) {
      group = { effect, positions: [], vobIds: [] };
      byEffect.set(key, group);
    }
    group.positions.push(positions[vob * 3], positions[vob * 3 + 1], positions[vob * 3 + 2]);
    group.vobIds.push(vob);
    vobs++;
  }

  const groups: ParticleVobGroup[] = [];
  let particles = 0;
  for (const group of byEffect.values()) {
    const count = group.vobIds.length;
    const instances = count * particlesPerVob(group.effect);
    particles += instances;
    groups.push({
      effect: group.effect,
      count,
      particles: instances,
      positions: new Float32Array(group.positions).buffer,
      vobIds: new Uint32Array(group.vobIds).buffer,
    });
  }

  return { groups, stats: { effects: groups.length, vobs, particles } };
}
