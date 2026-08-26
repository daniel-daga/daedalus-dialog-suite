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
  threeIndexOrder,
  mirrorRotation,
  type Vec3,
} from '../src/coords';
import type { ZenRotation } from '../src/model/ops';

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

/** The right-handed geometric normal of a triangle, in the order given. */
function geometricNormal(
  corners: readonly (readonly [number, number, number])[],
  order: readonly number[],
): [number, number, number] {
  const [a, b, c] = order.map((i) => corners[i]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Whether the GPU draws this triangle when the camera is on the side its stored
 * normal points to — a model of the *composite* rule, which is the only form of
 * the question that has a correct answer.
 *
 * Two things decide it and they are easy to double-count. The rasteriser calls a
 * triangle front-facing when its screen winding matches `gl.frontFace`, which is
 * CCW by default; and Three.js sets it to CW for any object whose `matrixWorld`
 * determinant is negative (`three/build/three.cjs`, `renderBufferDirect`:
 * `const frontFaceCW = ( object.isMesh && object.matrixWorld.determinant() < 0 )`).
 * So the mirror flips the winding and Three.js flips the test back. A model that
 * leaves out either half endorses whatever the code does.
 */
function drawnFromNormalSide(
  zenCorners: readonly (readonly [number, number, number])[],
  order: readonly number[],
  zenNormal: readonly [number, number, number],
): boolean {
  const converted = zenCorners.map((p) => zenToThree(p));
  const normal = zenToThree(zenNormal as [number, number, number]);

  const seenCcw = dot(geometricNormal(converted, order), normal) > 0;
  const frontFaceCw = det3(ROOT_MATRIX, 0, 1, 2) < 0;
  return frontFaceCw ? !seenCcw : seenCcw;
}

describe('zen-world/coords', () => {
  test('the root transform is a mirror', () => {
    // ZenGin is left-handed, so the conversion changes handedness, so the
    // determinant is negative. It is *not* what settles winding — Three.js
    // cancels a negative determinant's effect on the front/back test, which is
    // what `threeIndexOrder` exists for and what the tests below pin.
    expect(det3(ROOT_MATRIX, 0, 1, 2)).toBeLessThan(0);
  });

  test('a triangle wound as ZenGin stores it is drawn from the side its normal points to', () => {
    // The measured fact this whole convention rests on: read right-handed, the
    // geometric normal of a triangle in *stored* index order points against the
    // normals ZenGin stored on its corners — 230,395 of 230,395 loose-visual
    // triangles and 475,146 of 475,184 decidable NewWorld world-mesh triangles
    // (zenkit-node/scripts/check-visual-winding.js). This fixture is built to
    // have that property, so it stands in for every triangle in the corpus.
    const corners = [
      [0, 0, 0], [100, 0, 0], [0, 0, 100],
    ] as const satisfies readonly (readonly [number, number, number])[];
    const normal = [0, 1, 0] as const;
    expect(dot(geometricNormal(corners, [0, 1, 2]), normal)).toBeLessThan(0);

    // Stored order alone is inside-out: the world's floor is invisible from
    // above and its VOBs are turned inside out. That is the defect, asserted
    // rather than described.
    expect(drawnFromNormalSide(corners, [0, 1, 2], normal)).toBe(false);

    // Reversed at this boundary, it is drawn from outside — which is the whole
    // job, and it holds *with* Three.js' determinant compensation rather than
    // by ignoring it.
    expect(drawnFromNormalSide(corners, [...threeIndexOrder(Uint32Array.from([0, 1, 2]))], normal))
      .toBe(true);
  });

  test('a mirrored rotation turns points the same way on both sides of the conversion', () => {
    // What a rotation conversion has to satisfy, stated as the thing anyone can
    // see rather than as an algebraic identity: turn a point in ZenGin space and
    // convert it, or convert it and turn it in Three.js space, and the point
    // must land in the same place. Anything else is a VOB that turns one way on
    // screen and the other way in the engine.
    const random = lcg(0x5eed);
    const rotation = (): number[] => {
      // A rotation about a random axis by a random angle, row-major — built from
      // axis-angle so it is a rotation by construction rather than by hope.
      const axis = [random() - 0.5, random() - 0.5, random() - 0.5];
      const length = Math.hypot(...axis);
      const [x, y, z] = axis.map((component) => component / length);
      const angle = (random() - 0.5) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const t = 1 - c;
      return [
        t * x * x + c, t * x * y - s * z, t * x * z + s * y,
        t * x * y + s * z, t * y * y + c, t * y * z - s * x,
        t * x * z - s * y, t * y * z + s * x, t * z * z + c,
      ];
    };
    const apply = (m: readonly number[], p: readonly number[]): number[] => [
      m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
      m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
      m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
    ];

    for (let i = 0; i < 200; i++) {
      const inThree = rotation();
      const inZen = mirrorRotation(inThree as ZenRotation);
      const p: Vec3 = [(random() - 0.5) * 20000, (random() - 0.5) * 20000, (random() - 0.5) * 20000];

      const turnedThenConverted = zenToThree(apply(inZen, p) as [number, number, number]);
      const convertedThenTurned = apply(inThree, zenToThree(p));

      for (let axis = 0; axis < 3; axis++) {
        expect(turnedThenConverted[axis]).toBeCloseTo(convertedThenTurned[axis], 6);
      }
    }
  });

  test('mirroring a rotation twice is doing nothing — one function converts both ways', () => {
    // The conversion is a conjugation by an involution, so it is its own
    // inverse. Worth pinning: it is what makes "which direction is this
    // function?" an impossible question to get wrong at a call site.
    const yaw: ZenRotation = [0, 0, 1, 0, 1, 0, -1, 0, 0];
    expect(mirrorRotation(mirrorRotation(yaw))).toEqual(yaw);

    // And it is not the identity, which a sign error in the mask would make it.
    expect(mirrorRotation(yaw)).not.toEqual(yaw);
    // A quarter turn about Y becomes the opposite quarter turn about Y — the
    // observed defect, in one line.
    expect(mirrorRotation(yaw)).toEqual([0, 0, -1, 0, 1, 0, 1, 0, 0]);
  });

  test('mirroring leaves a rotation about X alone, and reverses Y and Z', () => {
    // The prediction that made the defect report diagnosable: conjugating by
    // diag(-1,1,1) maps a rotation about (x, y, z) to one about (x, -y, -z), so
    // the mirrored axis is the one that survives. Anyone testing the gizmo by
    // dragging the X ring would have seen nothing wrong.
    const quarter = (about: 'x' | 'y' | 'z'): ZenRotation => ({
      x: [1, 0, 0, 0, 0, -1, 0, 1, 0] as ZenRotation,
      y: [0, 0, 1, 0, 1, 0, -1, 0, 0] as ZenRotation,
      z: [0, -1, 0, 1, 0, 0, 0, 0, 1] as ZenRotation,
    }[about]);
    const transpose = (m: ZenRotation): ZenRotation => [
      m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8],
    ];

    expect(mirrorRotation(quarter('x'))).toEqual(quarter('x'));
    expect(mirrorRotation(quarter('y'))).toEqual(transpose(quarter('y')));
    expect(mirrorRotation(quarter('z'))).toEqual(transpose(quarter('z')));
  });

  test('threeIndexOrder reverses every triangle and touches nothing else', () => {
    const out = threeIndexOrder(Uint32Array.from([0, 1, 2, 7, 8, 9]));
    expect([...out]).toEqual([0, 2, 1, 7, 9, 8]);

    // A fresh buffer, because the payload it reads is a view over the transfer
    // from the worker: reversing in place would flip a second call back.
    const input = Uint32Array.from([0, 1, 2]);
    threeIndexOrder(input);
    expect([...input]).toEqual([0, 1, 2]);
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
