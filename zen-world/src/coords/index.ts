// THE ZenGin <-> Three.js conversion. There is exactly one of these in the
// codebase (level-editor.md §7): authoritative data — everything `zenkit-node`
// emits, everything an op carries, everything the property grid shows — is
// ZenGin-space, and this module is the only place that leaves it.
//
// ZenGin is left-handed and measures in centimetres. The conversion is
// therefore a mirror plus a scale, and it is applied *once*, as the transform
// of the node the whole scene hangs under. That keeps every buffer the binding
// emits untouched — positions, instance matrices and index order all stay in
// stored ZenGin form — and it means a VOB's local transform in the scene graph
// *is* its ZenGin placement, which is what makes reading a gizmo back cheap.
//
// Triangle winding belongs to this same boundary, which is why the binding
// refuses to decide it (zenkit-node/README.md, "Triangle winding"). Measured
// over the retail corpus, a triangle in stored index order read right-handed
// has its geometric normal pointing *against* the normals ZenGin stored on its
// corners — uniformly, through two independent readers. So the emitted order
// has to be reversed, and `threeIndexOrder` below is the one place that does
// it. Nobody reaches for `DoubleSide` to make a wrong choice invisible.
//
// **The mirror does not settle winding, and believing it did is what shipped an
// inside-out world.** A negative-determinant transform does invert the
// rasteriser's front/back test — and Three.js exists to hide that, so it
// inverts it straight back (`three/build/three.cjs`, `renderBufferDirect`:
// `const frontFaceCW = ( object.isMesh && object.matrixWorld.determinant() < 0
// )`). The two cancel, stored order is drawn from the inside, and every floor
// in the world is transparent from above. Any fix here has to be argued against
// the *composite* of those two rules; `test/coords.test.ts` models both halves
// for exactly that reason. Nor is there a matrix that avoids the problem: a
// change of handedness has a negative determinant by definition.

export type Vec3 = readonly [number, number, number];

/**
 * A **row-major** 3x3, the order `vobIndex` emits, `normalizeWorld` dumps and
 * `setVobRotation` takes — structurally the same tuple as `model/ops`'
 * `ZenRotation`, declared here rather than imported so the one module that must
 * not depend on anything keeps depending on nothing.
 *
 * Row-major with a column vector on the right (`v' = M v`), which is what
 * `placeBounds` in `model/ops` already assumes: the *columns* are the images of
 * the axes, so column 0 is the VOB's own X axis expressed in world space.
 */
export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * `[yaw, pitch, roll]` in **degrees**, ZenGin axes — the three numbers a level
 * designer types, holding the engine's own `GetEulerAngles` (x, y, z) as
 * (pitch, yaw, roll); see "Angles" below.
 *
 * Degrees rather than radians on purpose: the only consumer is a property grid,
 * and a second unit conversion in the renderer is exactly the kind of duplicated
 * convention this module exists to prevent.
 */
export type ZenEulerDegrees = [number, number, number];

/** A column-major 4x4, the order `THREE.Matrix4.elements` uses. */
export type Mat4 = readonly number[];

/** Centimetres to metres. */
export const ZEN_TO_THREE_SCALE = 0.01;

/**
 * The transform of the node the converted scene hangs under. Negating X is the
 * handedness flip; the scale is the unit change. Nothing else in the scene
 * graph converts anything.
 */
export const ROOT_MATRIX: Mat4 = Object.freeze([
  -ZEN_TO_THREE_SCALE, 0, 0, 0,
  0, ZEN_TO_THREE_SCALE, 0, 0,
  0, 0, ZEN_TO_THREE_SCALE, 0,
  0, 0, 0, 1,
]);

/**
 * A rotation converted between ZenGin space and Three.js space — conjugation by
 * the mirror, `M R M`, and its own inverse, so one function serves both
 * directions.
 *
 * **A quaternion cannot carry a mirror, which is why this has to exist.**
 * `Matrix4.decompose` answers a negative determinant by negating `scale.x`, so
 * `ROOT_MATRIX` decomposes to scale (-0.01, 0.01, 0.01) and a rotation of
 * **identity** — the flip vanishes from the quaternion entirely. Anything that
 * takes a rotation across this boundary as a quaternion therefore drops the
 * mirror silently. Translation survives it (`TransformControls` divides its
 * offset by that same negative scale, so the sign comes back); rotation does
 * not, and a VOB turns one way on screen and the other way in the engine.
 *
 * Conjugating by diag(-1, 1, 1) maps a rotation about (x, y, z) to one about
 * (x, -y, -z): **a rotation about X is unchanged, and Y and Z reverse.** In a
 * row-major 3x3 that is exactly the four terms coupling X with the other two.
 */
export function mirrorRotation<T extends readonly number[]>(rotation: T): T {
  const flip = [-1, 1, 1];
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const turned = flip[row] * flip[col] * rotation[row * 3 + col];
      // Negating a zero yields -0, which would reach `setVobRotation` and be
      // written to the world as a different float than the 0 that was there.
      // The roundtrip harness compares bytes, and this conversion is supposed to
      // be invisible to a VOB nobody turned.
      out[row * 3 + col] = turned === 0 ? 0 : turned;
    }
  }
  return out as unknown as T;
}

/**
 * ZenGin's stored triangle order as Three.js has to receive it: every triangle
 * reversed, nothing else touched.
 *
 * A fresh buffer rather than a reversal in place. What callers hold is a view
 * over the payload the worker transferred, and an in-place flip would make a
 * second call — a re-read of the same payload, a scene rebuilt after a
 * structural op — silently undo the first.
 */
export function threeIndexOrder(indices: Uint32Array): Uint32Array {
  const out = new Uint32Array(indices.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    out[i] = indices[i];
    out[i + 1] = indices[i + 2];
    out[i + 2] = indices[i + 1];
  }
  return out;
}

/** Apply a column-major 4x4 to a point. Present so `ROOT_MATRIX` is testable
 *  against the helpers below rather than merely declared beside them. */
export function applyRootMatrix(m: Mat4, p: Vec3): [number, number, number] {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/** ZenGin space (cm, left-handed) to Three.js space (m, right-handed). */
export function zenToThree(p: Vec3): [number, number, number] {
  return [-p[0] * ZEN_TO_THREE_SCALE, p[1] * ZEN_TO_THREE_SCALE, p[2] * ZEN_TO_THREE_SCALE];
}

/** Three.js space back to ZenGin space — for a raycast hit, a camera target, or
 *  anything else computed on the render side that has to become world data. */
export function threeToZen(p: Vec3): [number, number, number] {
  return [-p[0] / ZEN_TO_THREE_SCALE, p[1] / ZEN_TO_THREE_SCALE, p[2] / ZEN_TO_THREE_SCALE];
}

// ---------------------------------------------------------------------------
// Angles.
//
// A `zCVob` stores a 3x3 and a level designer types three numbers, so typed
// rotation entry needs a decomposition — and a decomposition is a *choice*,
// because three angles do not determine a matrix until the order they compose
// in is fixed. The choice made here, and why:
//
// **The convention is the engine's own — `zMAT4::GetEulerAngles` /
// `SetByEulerAngles` (Gothic2.exe `0x00516390` / `0x005163D0`, via
// `zCQuat::EulerToQuat` / `QuatToEuler`), in degrees, about ZenGin's axes.**
// With `m[r][c]` the stored row-major 3x3 exactly as `trafoOSToWSRot` is
// written, the engine reads
//
//     x = atan2(m[1][2], m[2][2])     (pitch, about X)
//     y = asin(-m[0][2])              (yaw,   about Y — the middle, singular axis)
//     z = atan2(m[0][1], m[0][0])     (roll,  about Z)
//
// and at `|m[0][2]| >= 1` its lock branch sets `y = +-pi/2`, `z = 0`,
// `x = atan2(-m[2][1], m[1][1])`. In this module's column-vector terms that is
// **`R = Rx(-x) * Ry(-y) * Rz(-z)` — intrinsic X-Y-Z, every angle turning the
// opposite way from the right-handed matrix about its axis.** `ZenEulerDegrees`
// keeps its `[yaw, pitch, roll]` order; the *values* are the engine's (x, y, z)
// reordered, nothing more.
//
// - **This is the one Euler triple ZenGin has, and the only one a witness can
//   check.** The world format stores the matrix and nothing else, ZenKit has no
//   Euler conversion, and no Spacer shows an angle triple (level-editor.md
//   §16.4, 2026-09-02): Spacer.NET edits `trafoOSToWSRot` raw and uses
//   `GetEulerAngles()[1]` only as "around vertical axis" for its HUD. So "the
//   angles Spacer would show" was never a thing to match, and the engine's
//   formula is — a ten-line Union plugin calling `GetEulerAngles()` on a known
//   VOB compares directly against the three lines above.
// - **The order is where it breaks, and the engine chose the vertical.** Every
//   order has one degenerate pose — the middle axis at +-90 degrees, where the
//   outer two coincide — and the middle axis of X-Y-Z is Y, so the singularity
//   is a VOB turned a quarter turn about the vertical. Measured across the
//   41,393 VOBs of retail NewWorld, OldWorld and AddonWorld, **464 sit within
//   1e-6 of it** (1,064 within 1e-3), because that is the commonest deliberate
//   pose in the game. The convention that shipped first (2026-08-28) was
//   `Ry * Rx * Rz` for exactly that reason — its pole is a VOB stood on its
//   nose, 53 VOBs — and was replaced 2026-09-02 because those 464 are also the
//   ones the engine itself shows on the pole, and matching the engine is worth
//   more than dodging its lock.
//
// **Gimbal lock is answered the engine's way, not avoided.** At yaw = +-90 the
// pitch and roll axes are the same axis and only their sum is observable, so
// no decomposition can return the pair that was typed. `zenRotationToEuler`
// puts the whole turn in **pitch and returns roll 0**, as `GetEulerAngles`
// does; the matrix still round-trips inside tolerance, and re-decomposing the
// rewritten angles is a fixed point. The dangerous part is the *neighbourhood*,
// not the pole: a "close enough to the pole" epsilon in sine space discards a
// roll that is still perfectly recoverable and moves the VOB (measured: an
// epsilon of 1e-7 costs 8.5e-4 of matrix entry, four orders above the tolerance
// the tests hold). So there is no epsilon — the lock branch is the engine's
// own `|m[0][2]| >= 1`, taken only when `asin` is at its end and the ordinary
// `atan2` pairs have no direction left at all, which is exactly the case it
// exists for.
//
// **A non-orthonormal matrix is normalized, and its scale and shear are
// dropped.** Retail data is not orthonormal: 12,514 of those 41,393 VOBs
// (30.2 %) deviate by more than 1e-6 in max |MtM - I|, worst 2.1e-2 — drift
// rather than deliberate scale (`|det - 1|` never exceeds 2.5e-2 and no VOB is
// mirrored), but far above float32 noise. Refusing them would leave typed angles
// unavailable on a third of the world, so the columns are Gram-Schmidt'd and the
// angles describe the nearest rotation. The consequence a caller must know:
// **round-tripping such a VOB's angles rewrites its matrix** to the
// orthonormalized one, so a UI must not write an angle back that the user did
// not change. A reflection or a rank-deficient matrix is refused instead — no
// triple of angles describes either, and retail has 0 of both.
//
// **Tolerance.** A stored entry is float32, whose ulp near 1 is 5.96e-8, and
// each direction runs a handful of transcendental operations; a few ulps is
// therefore the order the arithmetic justifies. Measured worst matrix round trip
// is 5.96e-8 over 200k random poses and 2.98e-8 over all 41,393 retail VOBs, and
// `test/coords.test.ts` asserts 1e-6.

const DEGREES_PER_RADIAN = 180 / Math.PI;
const RADIANS_PER_DEGREE = Math.PI / 180;

/** Negating a zero yields -0, which reaches `setVobRotation` as a different
 *  float than the 0 that was there — the rule `mirrorRotation` already carries,
 *  and the identity pose is the case that hits it (`-cos(0) * sin(0)`). */
const noNegativeZero = (v: number): number => (v === 0 ? 0 : v);

/**
 * The angles of a stored rotation, `[yaw, pitch, roll]` in degrees — the
 * engine's `zMAT4::GetEulerAngles` (x, y, z) as (pitch, yaw, roll).
 *
 * Canonical range: pitch and roll in (-180, 180], yaw in [-90, 90] — the band
 * `atan2` and `asin` answer in, and the only one in which the decomposition is
 * a function at all.
 *
 * @throws RangeError if the matrix is a reflection or has no three independent
 * columns; neither is a rotation, and neither occurs in retail data.
 */
export function zenRotationToEuler(rotation: readonly number[]): ZenEulerDegrees {
  const m = orthonormalizeColumns(rotation);

  // m[2] is m[0][2] = -sin(yaw): the one entry X-Y-Z leaves a single angle in,
  // which is why the yaw is the angle read first and directly.
  const yaw = Math.asin(Math.min(1, Math.max(-1, -m[2])));

  // Away from the pole, pitch and roll each read off a pair of entries that
  // share a factor of cos(yaw) — `atan2` divides it out, however small it is.
  if (Math.abs(m[2]) < 1) {
    return [
      noNegativeZero(yaw * DEGREES_PER_RADIAN),
      noNegativeZero(Math.atan2(m[5], m[8]) * DEGREES_PER_RADIAN),
      noNegativeZero(Math.atan2(m[1], m[0]) * DEGREES_PER_RADIAN),
    ];
  }

  // cos(yaw) is 0: the pitch and roll axes coincide and only the combined turn
  // survives. The engine puts it in the pitch: `x = atan2(-m[2][1], m[1][1])`.
  return [
    noNegativeZero(yaw * DEGREES_PER_RADIAN),
    noNegativeZero(Math.atan2(-m[7], m[4]) * DEGREES_PER_RADIAN),
    0,
  ];
}

/** The stored rotation for `[yaw, pitch, roll]` degrees — the engine's
 *  `SetByEulerAngles`, `Rx(-pitch) * Ry(-yaw) * Rz(-roll)`, row-major, in
 *  ZenGin space. The exact inverse of `zenRotationToEuler` for any pose it can
 *  answer. */
export function eulerToZenRotation(euler: readonly number[]): Mat3 {
  const yaw = euler[0] * RADIANS_PER_DEGREE;
  const pitch = euler[1] * RADIANS_PER_DEGREE;
  const roll = euler[2] * RADIANS_PER_DEGREE;

  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);

  return [
    cy * cr, cy * sr, -sy,
    -cp * sr + sp * sy * cr, cp * cr + sp * sy * sr, sp * cy,
    sp * sr + cp * sy * cr, -sp * cr + cp * sy * sr, cp * cy,
  ].map(noNegativeZero) as Mat3;
}

/**
 * The world-space turn that takes the pose `from` to the pose `to` — the delta
 * `rotateVobs` composes on the **left** of each selected VOB's own matrix.
 *
 * This is the whole of typed rotation for a multi-selection (level-editor.md
 * §16.4): with N VOBs selected a typed angle turns each of them by that much
 * from where it is, rather than snapping them all to one absolute pose, which is
 * the rule the position fields already follow so a selection keeps its shape.
 *
 * **It takes two angle triples, not a stored matrix, and that is the point.**
 * 30.2 % of retail VOBs store a matrix that is non-orthonormal by more than
 * 1e-6, so a delta built as `R(to) * M^-1` from the anchor's stored `M` would
 * carry that VOB's drift and apply it to every other VOB in the selection.
 * Built from the angles the read already showed, the delta is exactly a
 * rotation, and the anchor's drift stays where it was — nothing but the turn
 * the user asked for reaches the other N-1.
 *
 * `R(from)` is orthonormal by construction, so its inverse is its transpose and
 * there is no matrix inversion here to be ill-conditioned. The 3x3 product is
 * written out rather than taken from `model/ops`' `multiplyRotation`: `coords`
 * is the layer below the op model and does not import it.
 */
export function eulerDeltaRotation(
  from: readonly number[], to: readonly number[],
): Mat3 {
  const a = eulerToZenRotation(to);
  const b = eulerToZenRotation(from);

  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      // `b` transposed — column `col` of the inverse is row `col` of `b`.
      out[row * 3 + col] = noNegativeZero(
        a[row * 3] * b[col * 3]
        + a[row * 3 + 1] * b[col * 3 + 1]
        + a[row * 3 + 2] * b[col * 3 + 2],
      );
    }
  }
  return out as Mat3;
}

/**
 * The nearest rotation to a stored matrix — Gram-Schmidt over its columns, which
 * are the VOB's own axes in world space, so the first axis is kept exactly and
 * the others are squared up against it.
 *
 * The determinant is checked *after* normalizing rather than before, because the
 * question is whether the orientation the angles will describe is a rotation,
 * and a near-degenerate matrix can answer that only once its axes are unit.
 */
function orthonormalizeColumns(m: readonly number[]): number[] {
  const column = (j: number): number[] => [m[j], m[3 + j], m[6 + j]];
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (v: number[]): number[] => {
    const length = Math.hypot(v[0], v[1], v[2]);
    if (!(length > 0) || !Number.isFinite(length)) {
      throw new RangeError('rotation matrix has no three independent axes');
    }
    return [v[0] / length, v[1] / length, v[2] / length];
  };
  const reject = (v: number[], onto: number[]): number[] => {
    const s = dot(v, onto);
    return [v[0] - onto[0] * s, v[1] - onto[1] * s, v[2] - onto[2] * s];
  };

  const x = unit(column(0));
  const y = unit(reject(column(1), x));
  const z = unit(reject(reject(column(2), x), y));

  const determinant = x[0] * (y[1] * z[2] - y[2] * z[1])
    - y[0] * (x[1] * z[2] - x[2] * z[1])
    + z[0] * (x[1] * y[2] - x[2] * y[1]);
  if (determinant < 0) {
    throw new RangeError('rotation matrix is a reflection, which no angles describe');
  }

  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

export interface ThreeBox {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
}

/**
 * Convert an axis-aligned box — `extractWorldMesh`'s `[minX, minY, minZ, maxX,
 * maxY, maxZ]` — to Three.js space. The mirror inverts the X ordering, so the
 * converted corners have to be re-sorted; a box with `min.x > max.x` frames a
 * camera on nothing and reports no error while doing it.
 */
export function zenBoxToThree(box: readonly number[]): ThreeBox {
  const a = zenToThree([box[0], box[1], box[2]]);
  const b = zenToThree([box[3], box[4], box[5]]);

  const min: [number, number, number] = [
    Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
  const max: [number, number, number] = [
    Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];

  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}
