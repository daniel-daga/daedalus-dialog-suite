// Picking pixel-sized waypoint origin markers (level-editor.md §7).
// Solid 3D arrows are raycast separately by WaynetOverlay.
//
// GPU ID-picking draws VOB instances, not these Points vertices. A Points
// raycast uses world units, while these markers have a fixed pixel size, so
// their proximity pick belongs in screen space after projection.
//
// Pixel marker layers share pickPoint: waypoint origins, spawn markers and
// VOBs with no visual all need the same projection and optional visibility
// predicate. The loop is a per-click cost rather than a per-frame one.

import * as THREE from 'three';

/** Nothing was near enough. Distinguishable from point 0, which is an ordinary
 *  point like any other — the same reason `NO_PICK` is not zero. */
export const NO_POINT = -1;

/** {@link NO_POINT}, for the waynet's own caller. */
export const NO_WAYPOINT = NO_POINT;

/** Pixel radius for point markers, including the waypoint's origin reticle.
 *  Solid waypoint arrows are picked against their geometry separately. */
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
  return pickPoint(positions, toClip, x, y, width, height, radius);
}

/**
 * The point of a pixel-sized `THREE.Points` layer under the pointer, or
 * `NO_POINT` — an index into `positions`, three floats per point.
 *
 * The waynet's caller is {@link pickWaypoint}; the other is `VobMarkerLayer`,
 * which hands over only the points it is currently *drawing*, so a class the
 * view controls have switched off is not clickable either — and which passes
 * `accept`, so a marker hidden behind a wall is passed over for the next one.
 */
export function pickPoint(
  positions: Float32Array,
  toClip: THREE.Matrix4,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  accept?: (candidate: number) => boolean,
): number {
  let best = NO_POINT;
  let bestDistance = radius * radius;

  for (let candidate = 0; candidate * 3 + 2 < positions.length; candidate++) {
    const at = candidate * 3;
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
    // Last, so it is asked only of a point already nearer than the best — a
    // handful per click, however expensive the question.
    if (accept !== undefined && !accept(candidate)) continue;
    bestDistance = distance;
    best = candidate;
  }

  return best;
}
