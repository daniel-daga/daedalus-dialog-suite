// The scatter brush's stroke math (scatter.ts) — where a stroke *tries* to put
// something, decided without knowing what is there.
//
// The split this file is testing one half of: `zen-world` says where to try,
// the viewport raycasts each try and answers what it hit, and `scatterVobs`
// turns the survivors into ops. So nothing here knows about terrain, and every
// candidate it emits is a guess the caller is expected to reject or move.
//
// Determinism is the property most of these rest on: the RNG is seeded by the
// caller, so a stroke is reproducible and a test can assert an exact count.

import {
  SCATTER_ATTEMPTS_PER_SAMPLE,
  strokeCandidates,
  type ScatterSettings,
} from '../src/model';

const settings = (over: Partial<ScatterSettings> = {}): ScatterSettings => ({
  radius: 500, spacing: 200, limit: 200, ...over,
});

/** Ground-plane distance — the one the spacing rule measures, because foliage
 *  on a hillside is spaced across the ground and not through it. */
function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

describe('a stroke of one sample', () => {
  it('tries once per attempt, inside the brush radius', () => {
    const { candidates } = strokeCandidates(
      [[0, 0, 0]], settings({ spacing: 0 }), 1, 1,
    );

    expect(candidates).toHaveLength(SCATTER_ATTEMPTS_PER_SAMPLE);
    for (const candidate of candidates) {
      expect(apart(candidate.at, [0, 0, 0])).toBeLessThanOrEqual(500);
    }
  });

  it('keeps the sample height, since the caller raycasts from it', () => {
    const { candidates } = strokeCandidates(
      [[0, 1234, 0]], settings({ spacing: 0 }), 1, 1,
    );

    expect(candidates.every((c) => c.at[1] === 1234)).toBe(true);
  });

  it('is reproducible under the same seed, and different under another', () => {
    const once = strokeCandidates([[0, 0, 0]], settings(), 1, 7).candidates;
    const again = strokeCandidates([[0, 0, 0]], settings(), 1, 7).candidates;
    const other = strokeCandidates([[0, 0, 0]], settings(), 1, 8).candidates;

    expect(again).toEqual(once);
    expect(other).not.toEqual(once);
  });
});

describe('spacing', () => {
  it('rejects a candidate closer than the spacing to one already accepted', () => {
    const { candidates } = strokeCandidates(
      // A long stroke, so the attempts far outnumber what the spacing allows.
      Array.from({ length: 40 }, (_, i) => [i * 50, 0, 0] as [number, number, number]),
      settings({ radius: 300, spacing: 250 }), 1, 3,
    );

    expect(candidates.length).toBeGreaterThan(1);
    for (let a = 0; a < candidates.length; a++) {
      for (let b = a + 1; b < candidates.length; b++) {
        expect(apart(candidates[a].at, candidates[b].at)).toBeGreaterThanOrEqual(250);
      }
    }
  });

  it('thins the same stroke as the spacing grows', () => {
    const stroke = Array.from(
      { length: 20 }, (_, i) => [i * 100, 0, 0] as [number, number, number],
    );
    const tight = strokeCandidates(stroke, settings({ spacing: 50 }), 1, 3).candidates;
    const loose = strokeCandidates(stroke, settings({ spacing: 400 }), 1, 3).candidates;

    expect(loose.length).toBeLessThan(tight.length);
  });
});

describe('the cap', () => {
  it('stops at the limit and says so', () => {
    const stroke = Array.from(
      { length: 200 }, (_, i) => [i * 400, 0, 0] as [number, number, number],
    );
    const { candidates, capped } = strokeCandidates(
      stroke, settings({ radius: 100, spacing: 10, limit: 25 }), 1, 3,
    );

    expect(candidates).toHaveLength(25);
    expect(capped).toBe(true);
  });

  it('is not reported for a stroke that fits', () => {
    const { candidates, capped } = strokeCandidates(
      [[0, 0, 0]], settings({ spacing: 0, limit: 500 }), 1, 3,
    );

    expect(candidates.length).toBeLessThan(500);
    expect(capped).toBe(false);
  });
});

describe('the palette', () => {
  it('draws every member of a palette over a long enough stroke', () => {
    const stroke = Array.from(
      { length: 30 }, (_, i) => [i * 300, 0, 0] as [number, number, number],
    );
    const { candidates } = strokeCandidates(stroke, settings(), 4, 11);

    expect(new Set(candidates.map((c) => c.member))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('draws only member 0 from a palette of one', () => {
    const { candidates } = strokeCandidates([[0, 0, 0]], settings(), 1, 3);

    expect(candidates.every((c) => c.member === 0)).toBe(true);
  });

  it('yaws each candidate somewhere in a full turn', () => {
    const stroke = Array.from(
      { length: 30 }, (_, i) => [i * 300, 0, 0] as [number, number, number],
    );
    const { candidates } = strokeCandidates(stroke, settings(), 1, 5);

    expect(candidates.every((c) => c.yaw >= 0 && c.yaw < Math.PI * 2)).toBe(true);
    // Not all the same angle — a scatter that shares one yaw is visibly tiled,
    // which is the whole reason the yaw is here.
    expect(new Set(candidates.map((c) => c.yaw)).size).toBeGreaterThan(1);
  });
});

describe('degenerate strokes', () => {
  it('emits nothing for no samples', () => {
    expect(strokeCandidates([], settings(), 1, 3))
      .toEqual({ candidates: [], capped: false });
  });

  it('emits nothing for an empty palette', () => {
    expect(strokeCandidates([[0, 0, 0]], settings(), 0, 3))
      .toEqual({ candidates: [], capped: false });
  });

  it('decimates samples the cursor barely moved between', () => {
    // Sixty pointermoves across a tenth of the radius is one brush position,
    // not sixty: the raw event stream is what this is handed.
    const crawl = Array.from(
      { length: 60 }, (_, i) => [i, 0, 0] as [number, number, number],
    );
    const { candidates } = strokeCandidates(crawl, settings({ spacing: 0 }), 1, 3);

    expect(candidates).toHaveLength(SCATTER_ATTEMPTS_PER_SAMPLE);
  });
});
