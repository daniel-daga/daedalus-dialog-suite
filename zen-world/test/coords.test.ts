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
  zenRotationToEuler,
  eulerToZenRotation,
  eulerDeltaRotation,
  type Vec3,
  type Mat3,
  type ZenEulerDegrees,
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

/**
 * The matrix <-> angle conversion typed rotation entry needs (level-editor.md
 * §14.1 row 1.5). A `zCVob` stores a 3x3, a level designer types three numbers,
 * and the only defensible bridge between them is one the tests can hold to a
 * stated tolerance — so every test here pins a *round trip* or a *convention*,
 * never a formula restated.
 *
 * The tolerances are not "whatever made it pass". A retail rotation arrives as
 * **float32**, whose ulp near 1 is 5.96e-8, and both directions run a handful of
 * transcendental operations over it — so a few ulps, 1e-6 on a matrix entry, is
 * the order the arithmetic justifies, and anything larger is a formula error
 * rather than rounding. Measured over 200k random poses the worst observed
 * float32 matrix round trip is 5.96e-8 (exactly one ulp) and over the 41,393
 * VOBs of retail NewWorld/OldWorld/AddonWorld it is 2.98e-8; the assertions
 * below are ~17x above that, which is headroom for a different libm and not
 * room for a wrong formula.
 */
describe('zen-world/coords — typed angles', () => {
  // A local 3x3 multiply so these tests do not depend on `model/ops`' own
  // multiplyRotation: a convention test that shares an implementation with the
  // code it checks against is checking nothing.
  const mul = (a: readonly number[], b: readonly number[]): number[] => {
    const out = new Array<number>(9);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        out[row * 3 + col] = a[row * 3] * b[col]
          + a[row * 3 + 1] * b[3 + col]
          + a[row * 3 + 2] * b[6 + col];
      }
    }
    return out;
  };
  const applyTo = (m: readonly number[], v: readonly number[]): number[] => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
  const f32 = (m: readonly number[]): number[] => Array.from(Float32Array.from(m));
  const maxEntryError = (a: readonly number[], b: readonly number[]): number => {
    let worst = 0;
    for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    return worst;
  };

  // The three quarter turns the existing mirror tests above already use, so the
  // convention is pinned against a fixture the file already trusts.
  const quarterX: Mat3 = [1, 0, 0, 0, 0, -1, 0, 1, 0];
  const quarterY: Mat3 = [0, 0, 1, 0, 1, 0, -1, 0, 0];
  const quarterZ: Mat3 = [0, -1, 0, 1, 0, 0, 0, 0, 1];

  test('each angle is a quarter turn about its own ZenGin axis, in the sense the matrix names', () => {
    // What "yaw", "pitch" and "roll" *mean* here, stated as the axis each one
    // turns and the direction it turns it. Anything vaguer leaves the sign of a
    // typed angle undefined, and a sign error is exactly the defect the mirror
    // shipped once already.
    expect(eulerToZenRotation([90, 0, 0]).map(Math.round)).toEqual(quarterY);
    expect(eulerToZenRotation([0, 90, 0]).map(Math.round)).toEqual(quarterX);
    expect(eulerToZenRotation([0, 0, 90]).map(Math.round)).toEqual(quarterZ);

    // And the sense, in ZenGin's own stored coordinates: +yaw takes +Z to +X,
    // +pitch takes +Y to +Z, +roll takes +X to +Y.
    expect(applyTo(eulerToZenRotation([90, 0, 0]), [0, 0, 1]).map(Math.round)).toEqual([1, 0, 0]);
    expect(applyTo(eulerToZenRotation([0, 90, 0]), [0, 1, 0]).map(Math.round)).toEqual([0, 0, 1]);
    expect(applyTo(eulerToZenRotation([0, 0, 90]), [1, 0, 0]).map(Math.round)).toEqual([0, 1, 0]);
  });

  test('the order is Y then X then Z, which is what a wrong order silently changes', () => {
    // The whole content of "which convention": the composition order. Every
    // order agrees on a single-axis turn, so the tests above cannot tell them
    // apart and this one has to. Built from the three axis matrices rather than
    // from the implementation's own formula.
    const axis = (angle: number, about: 'x' | 'y' | 'z'): number[] => {
      const c = Math.cos((angle * Math.PI) / 180);
      const s = Math.sin((angle * Math.PI) / 180);
      return {
        x: [1, 0, 0, 0, c, -s, 0, s, c],
        y: [c, 0, s, 0, 1, 0, -s, 0, c],
        z: [c, -s, 0, s, c, 0, 0, 0, 1],
      }[about];
    };

    const yxz = mul(axis(30, 'y'), mul(axis(40, 'x'), axis(50, 'z')));
    expect(maxEntryError(eulerToZenRotation([30, 40, 50]), yxz)).toBeLessThan(1e-12);

    // The order actually matters on this input — a test that passed for XYZ too
    // would be pinning nothing.
    const xyz = mul(axis(40, 'x'), mul(axis(30, 'y'), axis(50, 'z')));
    expect(maxEntryError(yxz, xyz)).toBeGreaterThan(0.1);
  });

  test('a float32 matrix survives matrix -> angles -> matrix within a few ulps', () => {
    // The property the card exists for, over a spread rather than a fixture:
    // a stored rotation must come back the rotation it was. float32 in, float32
    // out, because that is what `vobIndex` emits and what `setVobRotation` takes.
    const random = lcg(4242);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const pose: ZenEulerDegrees = [
        random() * 360 - 180, random() * 180 - 90, random() * 360 - 180,
      ];
      const stored = f32(eulerToZenRotation(pose));
      const back = f32(eulerToZenRotation(zenRotationToEuler(stored)));
      worst = Math.max(worst, maxEntryError(stored, back));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  test('angles survive angles -> matrix -> angles, inside the canonical range', () => {
    // The other direction, and the range that makes it well-posed at all: the
    // decomposition can only answer in one canonical band, so the property is
    // stated over that band. `pitch` is kept off the pole here on purpose —
    // there the *angles* are genuinely not recoverable, which is the next test.
    const random = lcg(99);
    for (let i = 0; i < 2000; i++) {
      const pose: ZenEulerDegrees = [
        random() * 358 - 179, random() * 176 - 88, random() * 358 - 179,
      ];
      const back = zenRotationToEuler(eulerToZenRotation(pose));
      for (let angle = 0; angle < 3; angle++) {
        expect(back[angle]).toBeCloseTo(pose[angle], 5);
      }
      expect(back[0]).toBeGreaterThan(-180);
      expect(back[0]).toBeLessThanOrEqual(180);
      expect(back[1]).toBeGreaterThanOrEqual(-90);
      expect(back[1]).toBeLessThanOrEqual(90);
      expect(back[2]).toBeGreaterThan(-180);
      expect(back[2]).toBeLessThanOrEqual(180);
    }
  });

  test('at the pole the roll is folded into the yaw, and the matrix still round-trips', () => {
    // Gimbal lock: at pitch = +-90 the yaw and roll axes coincide, so only their
    // sum (or difference) is observable and no decomposition can return the pair
    // that was typed. The rule is stated rather than left to the arithmetic:
    // **roll comes back 0 and the yaw carries the whole turn**. What survives is
    // the thing the world stores — the matrix — so a designer who types a pole
    // pose gets the orientation asked for, with the angles rewritten.
    // Built exactly rather than by asking for pitch 90: `cos(90 degrees)` is
    // 6.1e-17 and not 0, so a matrix *computed* from a pole pose is near the
    // pole and decomposes normally — which is the right answer and is why the
    // next test exists. Measured, **no retail VOB is stored exactly on the pole**
    // (0 of 41,393 take this branch; 53 are within 1e-6 of it and decompose the
    // ordinary way), so this is the authored and the corrupted case rather than
    // one a designer reaches by typing 90.
    //
    // At pitch = +90 the observable is yaw - roll, at -90 it is yaw + roll:
    // with cos(pitch) = 0 every entry collapses to one angle-sum identity, which
    // is gimbal lock written out.
    const poled = (pitch: 90 | -90, combined: number): Mat3 => {
      const c = Math.cos((combined * Math.PI) / 180);
      const s = Math.sin((combined * Math.PI) / 180);
      return pitch === 90
        ? [c, s, 0, 0, 0, -1, -s, c, 0]
        : [c, -s, 0, 0, 0, 1, -s, -c, 0];
    };

    for (const [pitch, yaw, roll] of [[90, 37, 13], [-90, 37, 13]] as const) {
      const combined = pitch === 90 ? yaw - roll : yaw + roll;
      const stored = poled(pitch, combined);
      const back = zenRotationToEuler(stored);

      expect(back[2]).toBe(0);
      expect(back[1]).toBeCloseTo(pitch, 6);
      expect(back[0]).toBeCloseTo(combined, 6);
      expect(back).not.toEqual([yaw, pitch, roll]);

      // Stable: the rewritten angles describe the same orientation, and
      // re-decomposing them is a fixed point rather than a drift.
      expect(maxEntryError(f32(eulerToZenRotation(back)), stored)).toBeLessThan(1e-6);

      // Angles, to 1e-4 degrees rather than exactly: the rebuilt matrix is
      // *near* the pole and not on it, so it comes back through the ordinary
      // branch. One float32 ulp of matrix entry is 5.96e-8, which is 3.4e-6
      // degrees of angle away from the pole and worse as the pole is
      // approached — 1e-4 is that, with room, and still four orders below
      // anything a designer could see.
      const again = zenRotationToEuler(f32(eulerToZenRotation(back)));
      for (let angle = 0; angle < 3; angle++) {
        expect(again[angle]).toBeCloseTo(back[angle], 4);
      }
    }
  });

  test('approaching the pole does not jump — the matrix round trip stays inside tolerance', () => {
    // The dangerous half of gimbal lock is not the pole itself but its
    // neighbourhood, where a naive "if |sin pitch| > 1 - eps" branch discards a
    // roll that is still perfectly observable and moves the VOB. Measured: an
    // eps of 1e-7 in sine space costs 8.5e-4 of matrix entry, four orders above
    // the tolerance below.
    for (const eps of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6]) {
      const stored = f32(eulerToZenRotation([37, 90 - eps, 13]));
      const back = zenRotationToEuler(stored);
      expect(maxEntryError(f32(eulerToZenRotation(back)), stored)).toBeLessThan(1e-6);
    }
  });

  test('a matrix carrying scale or shear is read as the rotation nearest it', () => {
    // Retail data is not orthonormal: measured over the 41,393 VOBs of the three
    // retail worlds, **12,514 (30.2 %) deviate from orthonormal by more than
    // 1e-6** in max |MtM - I|, worst 2.1e-2 — small drift rather than deliberate
    // scale, but far above float32 noise. Refusing them would make typed angles
    // unavailable on a third of the world, so the decision is to normalize: the
    // scale and the shear are **dropped**, not carried, and the caller is told so
    // by this test rather than by a comment.
    const rotation = eulerToZenRotation([25, -40, 110]);
    const scaled = rotation.map((v, i) => v * (i % 3 === 0 ? 2 : 1)) as Mat3;
    expect(zenRotationToEuler(scaled)[0]).toBeCloseTo(25, 6);
    expect(zenRotationToEuler(scaled)[1]).toBeCloseTo(-40, 6);
    expect(zenRotationToEuler(scaled)[2]).toBeCloseTo(110, 6);

    // Which means the conversion is *not* the identity on such a matrix, and a
    // UI that writes an unchanged angle back would re-orthonormalize the VOB.
    const rebuilt = eulerToZenRotation(zenRotationToEuler(scaled));
    expect(maxEntryError(rebuilt, scaled)).toBeGreaterThan(0.5);
    expect(maxEntryError(rebuilt, rotation)).toBeLessThan(1e-6);
  });

  test('a reflection and a collapsed matrix are refused rather than answered', () => {
    // No triple of angles describes a reflection, and none describes a matrix
    // with no third axis left. Measured: **0 of the 41,393 retail VOBs** are
    // either — every one has a positive determinant and three independent
    // columns — so refusing costs nothing on real data and keeps the function
    // from inventing an orientation for a world that has been corrupted.
    const reflected: Mat3 = [-1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(() => zenRotationToEuler(reflected)).toThrow(RangeError);

    const collapsed: Mat3 = [1, 0, 0, 0, 1, 0, 1, 0, 0];
    expect(() => zenRotationToEuler(collapsed)).toThrow(RangeError);

    const zeroed: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(() => zenRotationToEuler(zeroed)).toThrow(RangeError);
  });

  test('no angle produces a negative zero, because a -0 is a different byte in the world', () => {
    // The rule `mirrorRotation` already carries, for the same reason: these
    // matrices reach `setVobRotation`, the roundtrip harness compares bytes, and
    // -0 and 0 are different floats. An identity pose is the case that hits it —
    // `-cos(0) * sin(0)` is -0.
    for (const pose of [[0, 0, 0], [90, 0, 0], [0, 0, -90], [180, 90, 180]] as ZenEulerDegrees[]) {
      for (const entry of eulerToZenRotation(pose)) {
        expect(Object.is(entry, -0)).toBe(false);
      }
    }
  });

  test('an unturned VOB reads as all-zero angles and rebuilds as the identity', () => {
    // The commonest pose in the corpus — 7,488 of the 41,393 retail VOBs store
    // exactly the identity — and the one a typed field shows first.
    const identity: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(zenRotationToEuler(identity)).toEqual([0, 0, 0]);
    expect(eulerToZenRotation([0, 0, 0])).toEqual(identity);
  });

  // The multi-selection half of typed rotation (level-editor.md §16.4). A typed
  // angle with N VOBs selected turns each of them by that much from where it
  // is — the same shape the position fields already commit in, and the same
  // shape a gizmo drag arrives in — so the conversion the UI needs is
  // "two angle triples in, one world-space delta out".
  describe('the delta between two angle triples', () => {
    test('is the turn that takes the first pose to the second, applied on the left', () => {
      // The defining property, and the one the gizmo path depends on:
      // `rotateVobs` composes the delta on the left of each VOB's own matrix,
      // so the delta has to satisfy `delta * R(from) = R(to)` and not the other
      // product. Checked on a pose where the two orders differ.
      const from: ZenEulerDegrees = [30, 40, 50];
      const to: ZenEulerDegrees = [70, 40, 50];
      const delta = eulerDeltaRotation(from, to);

      expect(maxEntryError(mul(delta, eulerToZenRotation(from)), eulerToZenRotation(to)))
        .toBeLessThan(1e-12);
      // The other order is a different matrix here, so the test above is
      // pinning the side rather than passing on symmetry.
      expect(maxEntryError(mul(eulerToZenRotation(from), delta), eulerToZenRotation(to)))
        .toBeGreaterThan(0.1);
    });

    test('a change on one axis alone is the quarter turn about that axis', () => {
      // Written out rather than derived, so an implementation that composed the
      // wrong way round could not agree with the expectation.
      expect(maxEntryError(eulerDeltaRotation([0, 0, 0], [90, 0, 0]), quarterY)).toBeLessThan(1e-12);
      expect(maxEntryError(eulerDeltaRotation([0, 0, 0], [0, 90, 0]), quarterX)).toBeLessThan(1e-12);
      expect(maxEntryError(eulerDeltaRotation([0, 0, 0], [0, 0, 90]), quarterZ)).toBeLessThan(1e-12);
    });

    test('is the identity when nothing changed', () => {
      const identity: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      expect(maxEntryError(eulerDeltaRotation([30, 40, 50], [30, 40, 50]), identity))
        .toBeLessThan(1e-12);
    });

    test('is a pure rotation even when the VOB it came from is not', () => {
      // **The reason this takes angles and not the stored matrix.** 30.2 % of
      // retail VOBs store a matrix that is non-orthonormal by more than 1e-6;
      // a delta built as `R(to) * M^-1` from such an `M` carries that drift and
      // smears it across the whole selection. Built from the angles, the delta
      // is a rotation exactly, and the anchor's own drift stays on the anchor.
      const delta = eulerDeltaRotation([30, 0, 0], [40, 0, 0]);
      const ten = eulerToZenRotation([10, 0, 0]);

      expect(maxEntryError(delta, ten)).toBeLessThan(1e-12);
      // Orthonormal: its transpose is its inverse, and its determinant is +1.
      const transpose = [delta[0], delta[3], delta[6], delta[1], delta[4], delta[7],
        delta[2], delta[5], delta[8]];
      expect(maxEntryError(mul(delta, transpose), [1, 0, 0, 0, 1, 0, 0, 0, 1]))
        .toBeLessThan(1e-12);
    });

    test('never produces a negative zero, for the reason every matrix here does not', () => {
      for (const entry of eulerDeltaRotation([0, 0, 0], [0, 0, 0])) {
        expect(Object.is(entry, -0)).toBe(false);
      }
    });
  });
});
