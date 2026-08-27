// Picking a waypoint out of the waynet overlay (level-editor.md §7).
//
// The two picks the viewport already had are both wrong for a waypoint. GPU
// ID-picking draws instances, and a waypoint is a vertex in one `THREE.Points`
// with nothing to draw an id into. `THREE.Points.raycast` would work, but its
// threshold is in **world units** while the overlay draws with
// `sizeAttenuation: false` — every waypoint is the same 3.5 px whatever its
// distance, so a world-unit threshold is either unclickable at range or
// swallows half the net up close.
//
// So the pick happens where the sizes are actually equal: in pixels, after the
// projection. That is a loop over every waypoint, which sounds worse than it is
// — NewWorld has 2,959 of them and this runs once per click, not once per
// frame.

import * as THREE from 'three';

/** Nothing was near enough. Distinguishable from waypoint 0, which is an
 *  ordinary waypoint like any other — the same reason `NO_PICK` is not zero. */
export const NO_WAYPOINT = -1;

/** How near the pointer has to be, in pixels. Wider than the 3.5 px the overlay
 *  draws, because a waypoint is a dot and a dot is hard to hit exactly. */
export const WAYPOINT_PICK_RADIUS = 8;

const point = new THREE.Vector4();

/**
 * The waypoint under the pointer, or `NO_WAYPOINT`.
 *
 * `toClip` is projection × view × the scene root's matrix: the overlay's
 * positions are ZenGin centimetres and the mirrored root is what puts them in
 * the world, so the root has to be in here or every waypoint is picked at a
 * position it is not drawn at.
 *
 * `x`/`y` are pixels from the top-left of the canvas, as a `MouseEvent` gives
 * them relative to the bounding rect.
 */
export function pickWaypoint(
  positions: Float32Array,
  toClip: THREE.Matrix4,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number = WAYPOINT_PICK_RADIUS,
): number {
  let best = NO_WAYPOINT;
  let bestDistance = radius * radius;

  for (let waypoint = 0; waypoint * 3 + 2 < positions.length; waypoint++) {
    const at = waypoint * 3;
    point.set(positions[at], positions[at + 1], positions[at + 2], 1).applyMatrix4(toClip);
    // Behind the eye. Dividing by a negative w mirrors the point back into
    // view, so without this it is pickable on the opposite side of the screen
    // from anywhere it is drawn.
    if (point.w <= 0) continue;

    const screenX = ((point.x / point.w) + 1) / 2 * width;
    const screenY = (1 - (point.y / point.w)) / 2 * height;
    const distance = (screenX - x) ** 2 + (screenY - y) ** 2;

    // Nearest in pixels, and deliberately not nearest in depth: the overlay
    // draws with `depthTest: false`, so the waypoint the user sees on top is
    // not the nearest one, and picking by depth would select one they cannot
    // see. Strictly nearer, so an exact tie keeps the earlier index rather than
    // depending on iteration order to decide something arbitrary.
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = waypoint;
  }

  return best;
}
