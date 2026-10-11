/**
 * Picking a waypoint out of the overlay (level-editor.md §7, the waynet gizmo).
 *
 * A VOB is picked on the GPU, because a CPU raycast across the props costs
 * 14.2 ms. A waypoint cannot be: it is not an instance of anything, it has no
 * ID to draw, and the whole point cloud is one `THREE.Points`.
 *
 * `THREE.Points.raycast` is the obvious answer and the wrong one. Its threshold
 * is in **world units**, and the overlay draws with `sizeAttenuation: false` —
 * every waypoint is 3.5 px whatever its distance. A world-unit threshold picked
 * to work up close cannot be clicked at range, and one picked to work at range
 * swallows half the net up close. So the pick is done where the sizes are
 * actually equal: in pixels, after the projection.
 *
 * Projecting all of them per click is not the cost it sounds like — NewWorld
 * has 2,959 waypoints, and this runs once per click, not once per frame.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { pickWaypoint, NO_WAYPOINT } from '../src/renderer/world/pickWaypoint';

/**
 * A camera looking down -Z at the origin, and the clip matrix a viewport would
 * hand the pick. The overlay hangs under the mirrored root, so the real caller
 * multiplies that root's matrix in here too; the identity stands in for it.
 */
function clip(): THREE.Matrix4 {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix, camera.matrixWorldInverse,
  );
}

/** Where a point lands on a `size`-square viewport, in pixels from top-left. */
function screenOf(point: [number, number, number], size: number): [number, number] {
  const v = new THREE.Vector4(point[0], point[1], point[2], 1).applyMatrix4(clip());
  return [((v.x / v.w) + 1) / 2 * size, (1 - (v.y / v.w)) / 2 * size];
}

const SIZE = 400;

describe('pickWaypoint', () => {
  it('picks the waypoint under the pointer', () => {
    const positions = new Float32Array([-3, 0, 0, 0, 0, 0, 3, 0, 0]);
    const [x, y] = screenOf([3, 0, 0], SIZE);

    expect(pickWaypoint(positions, clip(), x, y, SIZE, SIZE)).toBe(2);
  });

  it('answers NO_WAYPOINT when the pointer is not near one', () => {
    // The empty answer has to be distinguishable from waypoint 0, which is why
    // it is a named sentinel and not `null` compared loosely somewhere.
    const positions = new Float32Array([0, 0, 0]);
    const [x, y] = screenOf([0, 0, 0], SIZE);

    expect(pickWaypoint(positions, clip(), x + 200, y, SIZE, SIZE)).toBe(NO_WAYPOINT);
    expect(NO_WAYPOINT).not.toBe(0);
  });

  it('measures the threshold in pixels, so distance does not change what is clickable', () => {
    // The defect a world-unit threshold has. These two waypoints are 1 and 40
    // units from the camera in world space, and off the axis by enough that
    // they land 200 px apart on screen — so neither is within the other's
    // radius and each answer is its own. Both must be pickable by that same
    // radius.
    const near: [number, number, number] = [0.35, 0, 9];
    const far: [number, number, number] = [-14, 0, -30];
    const positions = new Float32Array([...near, ...far]);
    const matrix = clip();

    for (const [at, expected] of [[near, 0], [far, 1]] as const) {
      const [x, y] = screenOf(at, SIZE);
      // Six pixels off centre, inside the radius for both.
      expect(pickWaypoint(positions, matrix, x + 6, y, SIZE, SIZE, 8)).toBe(expected);
      // And thirty is outside it for both.
      expect(pickWaypoint(positions, matrix, x + 30, y, SIZE, SIZE, 8)).toBe(NO_WAYPOINT);
    }
  });

  it('takes the nearest in pixels when two are within the radius', () => {
    // Not the nearest in depth: the overlay draws with `depthTest: false`, so
    // what the user sees on top is not the nearest one and picking by depth
    // would select something they cannot see.
    const positions = new Float32Array([0, 0, 0, 0.4, 0, 0]);
    const [x, y] = screenOf([0.4, 0, 0], SIZE);

    expect(pickWaypoint(positions, clip(), x, y, SIZE, SIZE, 100)).toBe(1);
  });

  it('ignores waypoints behind the camera', () => {
    // A point behind the eye projects with a negative w, and dividing by it
    // mirrors it back into view — so without this it is pickable at a position
    // it is not drawn at, on the opposite side of the screen.
    const behind = new Float32Array([0, 0, 40]);
    const matrix = clip();

    for (let x = 0; x <= SIZE; x += 20) {
      for (let y = 0; y <= SIZE; y += 20) {
        expect(pickWaypoint(behind, matrix, x, y, SIZE, SIZE, 1000)).toBe(NO_WAYPOINT);
      }
    }
  });
});
