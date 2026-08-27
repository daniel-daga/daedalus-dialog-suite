import * as THREE from 'three';

/**
 * Gizmo snapping (level-editor.md §14.1 item 1.6).
 *
 * **It is relative: what is quantised is the delta the drag has produced, not
 * the position or the orientation it lands on.** Two reasons, and the second is
 * the binding one:
 *
 *   - a finished drag already leaves the viewport as a *delta*, one for the
 *     whole selection — the decision typed coordinates made for the same reason
 *     (§14.1 row 1.5). Quantising that delta changes the one number the ops
 *     carry and nothing else; quantising the destination would put the anchor
 *     VOB on the grid and shift every other selected VOB by whatever that took,
 *     which is a rule the drag does not otherwise have.
 *   - an *absolute* angle cannot be snapped here at all. A `zCVob` stores a 3x3
 *     matrix and `zen-world` has no matrix↔Euler conversion, so "45° about Y" is
 *     not a quantity this app can read off a VOB. The turn since the press is,
 *     and it is exactly what the op carries. A relative grid step is the half of
 *     the pair that had a choice, and it is made to match.
 *
 * A step of 0 is off, which is what both default to.
 *
 * Both functions work in the proxy's own basis, which is where the gizmo writes
 * — ZenGin centimetres for the position, and for the turn a basis mirrored from
 * ZenGin's (see `WorldViewport.turnDelta`). Mirroring is a conjugation by an
 * orthogonal matrix, so it preserves a rotation's angle: an angle snapped here
 * is the same angle in ZenGin space.
 */

/** Scratch, so a drag frame allocates nothing. */
const scratchAxis = new THREE.Vector3();

/** The drag's delta, each axis quantised to the nearest multiple of `step`. */
export function snapDelta(
  delta: readonly [number, number, number], step: number,
): [number, number, number] {
  if (!(step > 0)) return [delta[0], delta[1], delta[2]];
  return [
    Math.round(delta[0] / step) * step,
    Math.round(delta[1] / step) * step,
    Math.round(delta[2] / step) * step,
  ];
}

/**
 * Quantise the turn `quaternion` represents to the nearest multiple of `step`
 * radians, about the axis it already turns on. In place, because this runs on
 * the scratch quaternion of a drag frame.
 */
export function snapTurn(quaternion: THREE.Quaternion, step: number): void {
  if (!(step > 0)) return;

  const sine = Math.sqrt(Math.max(0, 1 - quaternion.w * quaternion.w));
  // A press that has not turned anything: there is no axis to read, and one
  // rebuilt from floating-point noise would be a rotation the world never had.
  if (sine < 1e-6) return;

  const angle = 2 * Math.acos(Math.min(1, Math.max(-1, quaternion.w)));
  quaternion.setFromAxisAngle(
    scratchAxis.set(quaternion.x / sine, quaternion.y / sine, quaternion.z / sine),
    Math.round(angle / step) * step,
  );
}
