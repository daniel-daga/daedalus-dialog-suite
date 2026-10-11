/**
 * The scatter brush's stroke math (level-editor.md §16.25).
 *
 * Where a stroke *tries* to put something — and nothing more, because this
 * module cannot see the world. The brush is three layers and they are split by
 * what each one is able to answer:
 *
 *   1. here — a stroke of cursor points becomes candidate positions, each with
 *      a yaw and a palette member, and none of them is known to be on ground;
 *   2. the viewport — one downward raycast per candidate, which is the only
 *      layer holding a BVH, answering the ground point and its normal;
 *   3. `scatterVobs` in `ops.ts` — the survivors become one batch of `AddVob`s.
 *
 * So a candidate here is a *guess*, and the caller is expected to drop the ones
 * that hit nothing. That is why the cap is applied here rather than after the
 * raycasts: the cap exists to bound the batch the undo bar is handed, and a
 * stroke that overshot it has already been thinned before a ray is cast.
 */

import type { ZenPosition } from './ops';

/** What a stroke is handed as it is drawn: the surface point under the cursor,
 *  in ZenGin space, one per pointer event. Undecimated — see `strokeCandidates`. */
export type ScatterSample = ZenPosition;

/** The brush's shape, all of it in ZenGin centimetres. */
export interface ScatterSettings {
  /** How far from the cursor a candidate may fall, on the ground plane. */
  readonly radius: number;
  /** The closest two placements of one stroke may stand, on the ground plane.
   *  Zero accepts every attempt, which is what the density tests want. */
  readonly spacing: number;
  /** The hard cap on one stroke, because a stroke is one batch and therefore
   *  one undo entry — §15's bar has never been shown a batch of thousands. */
  readonly limit: number;
}

/** One thing the stroke would like to place, before anything has checked
 *  whether there is ground under it. */
export interface ScatterCandidate {
  /** Where to raycast down from — the sample's own height, since the cursor
   *  point is already on a surface and the offset is horizontal. */
  readonly at: ZenPosition;
  /** Radians about the world up axis, before the surface normal is applied. */
  readonly yaw: number;
  /** Which palette member this is a copy of, as an index into the palette. */
  readonly member: number;
}

/**
 * Tries per brush position. Density is the spacing's job — this only has to be
 * generous enough that the spacing, not the attempt count, is what thins a
 * stroke, which is what `thins the same stroke as the spacing grows` asserts.
 */
export const SCATTER_ATTEMPTS_PER_SAMPLE = 8;

/**
 * How far the cursor must travel before it counts as a new brush position, as a
 * fraction of the radius. A pointermove stream is 60+ events a second and a
 * slow drag delivers dozens within one brush width; without this the attempt
 * count would be a function of mouse speed rather than of distance covered.
 */
const RESAMPLE_FRACTION = 0.25;

/**
 * A seeded PRNG (mulberry32), so a stroke is reproducible.
 *
 * Reproducibility is not a feature anybody asked for — it is what lets a test
 * assert an exact placement count against a randomised algorithm, and what
 * makes a bug report about a stroke something more than a screenshot.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The candidates one stroke would place, thinned by spacing and stopped at the
 * cap.
 *
 * `samples` is the raw pointer stream and is decimated here rather than by the
 * caller: the decimation distance is a function of the radius, which is a
 * setting rather than something a pointer handler holds.
 *
 * The spacing rule measures **ground-plane** distance, not the full 3D
 * distance. Two trees on a steep hillside are as far apart as their footprints
 * are — a 3D measure would let a cliff face take twice the foliage of the flat
 * ground beside it, which is exactly backwards.
 *
 * Rejection is against every candidate already accepted, which is O(n²) — and
 * that is fine precisely because the cap is small: at the 200 the UI offers,
 * the worst case is 20k distance checks on one mouse-up.
 */
export function strokeCandidates(
  samples: readonly ScatterSample[],
  settings: ScatterSettings,
  palette: number,
  seed: number,
): { candidates: ScatterCandidate[]; capped: boolean } {
  if (samples.length === 0 || palette <= 0) return { candidates: [], capped: false };

  const random = mulberry32(seed);
  const candidates: ScatterCandidate[] = [];
  const step = settings.radius * RESAMPLE_FRACTION;

  let last: ScatterSample | null = null;
  for (const sample of samples) {
    // The first sample always counts: a click that never moves is still a
    // brush position, and it is how a single clump is placed.
    if (last !== null && Math.hypot(sample[0] - last[0], sample[2] - last[2]) < step) continue;
    last = sample;

    for (let attempt = 0; attempt < SCATTER_ATTEMPTS_PER_SAMPLE; attempt++) {
      if (candidates.length >= settings.limit) return { candidates, capped: true };

      // sqrt of a uniform, or the disc's middle takes far more than its share
      // of the tries and a stroke beads along its own path.
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * settings.radius;
      const at: ZenPosition = [
        sample[0] + Math.cos(angle) * distance,
        sample[1],
        sample[2] + Math.sin(angle) * distance,
      ];
      // Drawn before the rejection test rather than after, so that a stroke is
      // a function of its seed alone: pulling these only for survivors would
      // make the sequence depend on how many were rejected, and two runs of the
      // same stroke would diverge the first time a rounding difference changed
      // one acceptance.
      const yaw = random() * Math.PI * 2;
      const member = Math.floor(random() * palette) % palette;

      const tooClose = settings.spacing > 0 && candidates.some(
        (taken) => Math.hypot(taken.at[0] - at[0], taken.at[2] - at[2]) < settings.spacing,
      );
      if (!tooClose) candidates.push({ at, yaw, member });
    }
  }

  return { candidates, capped: false };
}
