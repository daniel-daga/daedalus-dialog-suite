// The single ZenGin <-> Three.js conversion (level-editor.md §7). Everything
// here guards one rule: authoritative data is ZenGin-space, and exactly one
// module knows how to leave it. A test that only re-states the constants would
// pass on a module that contradicts itself, so each test below pins a
// *consequence* — the determinant that settles winding, the agreement between
// the matrix and the point helpers, the round trip, and the axis a mirror
// inverts.

import {
  ROOT_MATRIX,
  ZEN_TO_THREE_SCALE,
  zenToThree,
  threeToZen,
  zenBoxToThree,
  applyRootMatrix,
} from '../src/coords';

// Deterministic, so a failure is reproducible: a property test that cannot be
// re-run on the input that broke it is a flake generator.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function det3(m: readonly number[], i: number, j: number, k: number): number {
  // Determinant of the upper-left 3x3 of a column-major 4x4, columns i/j/k.
  const c = (col: number, row: number) => m[col * 4 + row];
  return (
    c(i, 0) * (c(j, 1) * c(k, 2) - c(k, 1) * c(j, 2))
    - c(j, 0) * (c(i, 1) * c(k, 2) - c(k, 1) * c(i, 2))
    + c(k, 0) * (c(i, 1) * c(j, 2) - c(j, 1) * c(i, 2))
  );
}

describe('zen-world/coords', () => {
  test('the root transform is a mirror — which is what settles triangle winding', () => {
    // The binding emits indices in stored order and makes no winding claim
    // (zenkit-node/README.md). Measured, that order reads *against* the stored
    // normals in a right-handed basis; a negative determinant flips the
    // rasteriser's idea of front-facing, so after this transform it reads
    // *with* them and every material stays FrontSide. If this determinant ever
    // turns positive the whole world renders inside-out, which is precisely the
    // failure this assertion exists to catch before a screenshot does.
    expect(det3(ROOT_MATRIX, 0, 1, 2)).toBeLessThan(0);
  });

  test('zenToThree is the root matrix, not a second opinion of it', () => {
    // Two exports that describe one conversion are two chances to disagree.
    const random = lcg(0xc0ffee);
    for (let i = 0; i < 200; i++) {
      const p: [number, number, number] = [
        (random() - 0.5) * 200000,
        (random() - 0.5) * 200000,
        (random() - 0.5) * 200000,
      ];
      const viaHelper = zenToThree(p);
      const viaMatrix = applyRootMatrix(ROOT_MATRIX, p);
      for (let axis = 0; axis < 3; axis++) {
        expect(viaHelper[axis]).toBeCloseTo(viaMatrix[axis], 9);
      }
    }
  });

  test('the conversion round-trips', () => {
    const random = lcg(42);
    for (let i = 0; i < 500; i++) {
      const p: [number, number, number] = [
        (random() - 0.5) * 200000,
        (random() - 0.5) * 200000,
        (random() - 0.5) * 200000,
      ];
      const back = threeToZen(zenToThree(p));
      for (let axis = 0; axis < 3; axis++) {
        expect(back[axis]).toBeCloseTo(p[axis], 6);
      }
    }
  });

  test('centimetres become metres', () => {
    expect(ZEN_TO_THREE_SCALE).toBe(0.01);
    // Distance is scale only — it must not pick up the mirror's sign.
    const a = zenToThree([0, 0, 0]);
    const b = zenToThree([300, 400, 0]);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeCloseTo(5, 9);
  });

  test('X is the mirrored axis; Y and Z keep their sign', () => {
    expect(zenToThree([100, 200, 300])).toEqual([-1, 2, 3]);
    expect(threeToZen([-1, 2, 3])).toEqual([100, 200, 300]);
  });

  test('a converted box still has min <= max on every axis', () => {
    // The mirror inverts the X ordering, so a box converted corner-by-corner
    // comes out with min.x > max.x — a camera framed from it points nowhere.
    // This is the shape of the bug that made the spike report a flat draw-call
    // count, so it gets its own assertion rather than a comment.
    const box = zenBoxToThree([-1000, -2000, -3000, 4000, 5000, 6000]);
    for (let axis = 0; axis < 3; axis++) {
      expect(box.min[axis]).toBeLessThanOrEqual(box.max[axis]);
    }
    expect(box.min).toEqual([-40, -20, -30]);
    expect(box.max).toEqual([10, 50, 60]);
  });

  test('a converted box contains both converted corners, and its centre and size agree', () => {
    const random = lcg(7);
    for (let i = 0; i < 100; i++) {
      const lo = [(random() - 0.5) * 100000, (random() - 0.5) * 100000, (random() - 0.5) * 100000];
      const hi = lo.map((v) => v + random() * 100000);
      const box = zenBoxToThree([lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]]);

      for (const corner of [zenToThree(lo as [number, number, number]),
        zenToThree(hi as [number, number, number])]) {
        for (let axis = 0; axis < 3; axis++) {
          expect(corner[axis]).toBeGreaterThanOrEqual(box.min[axis] - 1e-6);
          expect(corner[axis]).toBeLessThanOrEqual(box.max[axis] + 1e-6);
        }
      }
      for (let axis = 0; axis < 3; axis++) {
        expect(box.center[axis]).toBeCloseTo((box.min[axis] + box.max[axis]) / 2, 6);
        expect(box.size[axis]).toBeCloseTo(box.max[axis] - box.min[axis], 6);
      }
    }
  });

  test('an all-zero box converts to an all-zero box rather than to NaN', () => {
    // Every retail zCMesh stores its bbox as all zeros; extractWorldMesh now
    // computes a real one, but a degenerate box must still be a box.
    // Compared numerically, not by deep equality: mirroring 0 yields -0, which
    // is the same number to every consumer and a different one to toEqual.
    const box = zenBoxToThree([0, 0, 0, 0, 0, 0]);
    for (let axis = 0; axis < 3; axis++) {
      expect(box.min[axis]).toBeCloseTo(0, 12);
      expect(box.max[axis]).toBeCloseTo(0, 12);
      expect(box.size[axis]).toBeCloseTo(0, 12);
      expect(Number.isNaN(box.center[axis])).toBe(false);
    }
  });
});
