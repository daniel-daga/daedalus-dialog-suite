// Which waypoints get their name drawn over them, and where on screen.
//
// The projection is `pickWaypoint`'s exactly — the overlay draws with
// `sizeAttenuation: false`, so screen pixels are the only space in which two
// waypoints are comparable — and the loop is the same shape for the same
// reason. Unlike the pick this runs in the draw loop rather than once per
// click, which is what the cap is for: NewWorld has 2,959 waypoints and a label
// on each is neither legible nor affordable, so only the nearest few are drawn
// and the rest are the dots they already were.

import * as THREE from 'three';

/** How many labels are drawn at once. Chosen to stay legible rather than to
 *  stay cheap — the DOM cost is a transform per label, and thirty names already
 *  cover a screen. */
export const LABEL_CAP = 24;

export interface WaypointLabel {
  waypoint: number;
  /** Pixels from the top-left of the canvas. */
  x: number;
  y: number;
}

const point = new THREE.Vector4();

/**
 * The nearest `cap` candidates that are actually on screen, nearest first.
 *
 * `candidates` is which waypoints are eligible — the drawn subset when only the
 * spawn layer is on — or `null` for every waypoint in `positions`. Labelling
 * something the viewport is not drawing would be a name floating over nothing.
 *
 * `toClip` is projection × view × the scene root's matrix, as `pickWaypoint`
 * takes it: the positions are ZenGin centimetres and the mirrored root is what
 * puts them in the world, so leaving the root out labels every waypoint at a
 * position it is not drawn at.
 */
export function chooseWaypointLabels(
  positions: Float32Array,
  candidates: readonly number[] | null,
  toClip: THREE.Matrix4,
  width: number,
  height: number,
  cap: number = LABEL_CAP,
): WaypointLabel[] {
  const count = Math.floor(positions.length / 3);
  const eligible = candidates ?? null;
  const total = eligible ? eligible.length : count;
  const found: (WaypointLabel & { depth: number })[] = [];

  for (let i = 0; i < total; i++) {
    const waypoint = eligible ? eligible[i] : i;
    const at = waypoint * 3;
    if (at + 2 >= positions.length) continue;

    point.set(positions[at], positions[at + 1], positions[at + 2], 1).applyMatrix4(toClip);
    // Behind the eye. Dividing by a negative w mirrors the point back into
    // view, so without this a waypoint behind the camera is labelled on the
    // opposite side of the screen — `pickWaypoint` guards the same way.
    if (point.w <= 0) continue;

    const x = (point.x / point.w * 0.5 + 0.5) * width;
    const y = (1 - (point.y / point.w * 0.5 + 0.5)) * height;
    if (x < 0 || x > width || y < 0 || y > height) continue;

    found.push({ waypoint, x, y, depth: point.w });
  }

  // Nearest first: `w` is the view-space depth, so the cap keeps the labels
  // around the camera rather than an arbitrary slice of the world.
  found.sort((a, b) => a.depth - b.depth);
  return found.slice(0, cap).map(({ waypoint, x, y }) => ({ waypoint, x, y }));
}
