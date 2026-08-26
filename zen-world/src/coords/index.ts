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
// The mirror also settles triangle winding, which is why the binding refuses to
// make that decision (zenkit-node/README.md, "Triangle winding"). Measured over
// the retail corpus, a triangle in stored index order read right-handed has its
// geometric normal pointing *against* the normals ZenGin stored on its corners
// — uniformly, through two independent readers. A negative-determinant
// transform inverts the rasteriser's front/back test, so under this node stored
// order reads *with* the stored normals and materials stay single-sided. Nobody
// downstream reverses an index buffer, and nobody reaches for `DoubleSide` to
// make a wrong choice invisible.

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
