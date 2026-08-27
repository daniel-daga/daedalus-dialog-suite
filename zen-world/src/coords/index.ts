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
