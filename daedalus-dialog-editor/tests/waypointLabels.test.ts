/**
 * Which waypoints get a name drawn over them (level-editor.md §16.19 slice 8).
 *
 * The projection is `pickWaypoint`'s, so the things that fail silently are its
 * too: a waypoint behind the camera is mirrored back into view by a negative
 * `w` and gets labelled on the wrong side of the screen, and a `toClip` built
 * without the scene root puts every label a hundred metres from its dot.
 *
 * The cap is the other half. NewWorld has 2,959 waypoints; labelling them all
 * is neither legible nor affordable, and which few survive has to be the ones
 * nearest the camera or the layer labels an arbitrary slice of the world.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { chooseWaypointLabels, labelTextFor, LABEL_CAP } from '../src/renderer/world/waypointLabels';

const WIDTH = 800;
const HEIGHT = 600;

/**
 * A camera at the origin looking down -Z, and the clip matrix for it. No scene
 * root here — the mirroring is the viewport's and is tested where it lives; what
 * matters for these is that whatever matrix is handed in is the one used.
 */
function clipMatrix(): THREE.Matrix4 {
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 1, 100000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
}

/** Points down the view axis: `[x, y, z]` triples straight into a buffer. */
const buffer = (...points: number[][]) => new Float32Array(points.flat());

/** The camera position `clipMatrix()` builds its view from — the origin. */
const AT_ORIGIN = new THREE.Vector3(0, 0, 0);

describe('chooseWaypointLabels', () => {
  it('places a waypoint in front of the camera at the centre of the screen', () => {
    const labels = chooseWaypointLabels(buffer([0, 0, -1000]), null, clipMatrix(), AT_ORIGIN, WIDTH, HEIGHT);

    expect(labels).toHaveLength(1);
    expect(labels[0].waypoint).toBe(0);
    expect(labels[0].x).toBeCloseTo(WIDTH / 2, 3);
    expect(labels[0].y).toBeCloseTo(HEIGHT / 2, 3);
  });

  it('drops a waypoint behind the camera instead of mirroring it into view', () => {
    // The bug this exists to prevent: a negative `w` divides the point back
    // onto the screen, so a waypoint behind you gets a name in front of you.
    const labels = chooseWaypointLabels(
      buffer([0, 0, 1000], [0, 0, -1000]), null, clipMatrix(), AT_ORIGIN, WIDTH, HEIGHT,
    );

    expect(labels.map((label) => label.waypoint)).toEqual([1]);
  });

  it('drops a waypoint that projects outside the canvas', () => {
    // Far off to the side but still in front — on screen it is nowhere, and a
    // label clamped to the edge would point at nothing.
    const labels = chooseWaypointLabels(
      buffer([100000, 0, -1000], [0, 0, -1000]), null, clipMatrix(), AT_ORIGIN, WIDTH, HEIGHT,
    );

    expect(labels.map((label) => label.waypoint)).toEqual([1]);
  });

  it('keeps the nearest when there are more than the cap', () => {
    // Ten waypoints receding down the view axis, furthest written first so a
    // pass that kept input order would fail this.
    const points = [];
    for (let i = 10; i >= 1; i--) points.push([0, 0, -1000 * i]);

    const labels = chooseWaypointLabels(buffer(...points), null, clipMatrix(), AT_ORIGIN, WIDTH, HEIGHT, 3);

    expect(labels).toHaveLength(3);
    // Index 9 is the -1000 one, 8 is -2000, 7 is -3000.
    expect(labels.map((label) => label.waypoint)).toEqual([9, 8, 7]);
  });

  it('ranks by true distance from the camera, not by depth into the screen', () => {
    // Waypoint 0 sits dead ahead at depth 1000 — true distance 1000.
    // Waypoint 1 sits off to the side at depth 900 — nearer to the view
    // plane, but sqrt(900² + 800²) ≈ 1204 away from the camera itself. A
    // depth-only sort (the view-space `w`, i.e. distance to the plane
    // through the camera perpendicular to where it's looking) would rank 1
    // ahead of 0; true distance — a sphere around the camera — ranks 0
    // ahead of 1.
    const labels = chooseWaypointLabels(
      buffer([0, 0, -1000], [800, 0, -900]), null, clipMatrix(), AT_ORIGIN, WIDTH, HEIGHT, 1,
    );

    expect(labels.map((label) => label.waypoint)).toEqual([0]);
  });

  it('labels only the candidates it is given', () => {
    // The spawn layer draws a subset, and a name over a dot the viewport is not
    // drawing is a name floating over nothing.
    const points = buffer([0, 0, -1000], [100, 0, -1000], [-100, 0, -1000]);

    const labels = chooseWaypointLabels(points, [2], clipMatrix(), AT_ORIGIN, WIDTH, HEIGHT);

    expect(labels.map((label) => label.waypoint)).toEqual([2]);
  });

  it('labels every waypoint when the candidates are null', () => {
    const points = buffer([0, 0, -1000], [100, 0, -1000], [-100, 0, -1000]);

    expect(chooseWaypointLabels(points, null, clipMatrix(), AT_ORIGIN, WIDTH, HEIGHT)).toHaveLength(3);
  });

  it('ignores a candidate past the end of the buffer', () => {
    // The candidate list and the payload come from different places — the spawn
    // overlay's drawn set and the waynet — and a world reopened under a stale
    // set would otherwise read off the end of the positions.
    const labels = chooseWaypointLabels(
      buffer([0, 0, -1000]), [0, 7], clipMatrix(), AT_ORIGIN, WIDTH, HEIGHT,
    );

    expect(labels.map((label) => label.waypoint)).toEqual([0]);
  });

  it('survives a world with no waypoints at all', () => {
    expect(chooseWaypointLabels(new Float32Array(0), null, clipMatrix(), AT_ORIGIN, WIDTH, HEIGHT)).toEqual([]);
  });

  it('caps at a legible number by default', () => {
    // Not a cheapness budget — thirty names already cover a screen.
    expect(LABEL_CAP).toBeLessThanOrEqual(40);

    const points = [];
    for (let i = 1; i <= LABEL_CAP + 10; i++) points.push([i, 0, -1000 * i]);

    expect(chooseWaypointLabels(buffer(...points), null, clipMatrix(), AT_ORIGIN, WIDTH, HEIGHT))
      .toHaveLength(LABEL_CAP);
  });
});

describe('labelTextFor', () => {
  // What a label says, once a marked point knows who is standing on it
  // (§16.19 slice 14). Slice 9 left this as the waypoint's own name because
  // `placementWaypointsAt` threw the instances away; the name of the waypoint
  // is still the answer where nobody is standing.

  it('names the waypoint when nobody is standing on it', () => {
    expect(labelTextFor('WP_MARKET', [])).toBe('WP_MARKET');
  });

  it('names the NPC instead, where one is', () => {
    // The marker is already the point; a second name for the point is not what
    // the label is scarce screen space for.
    expect(labelTextFor('WP_MARKET', ['BAU_900_FARIM'])).toBe('BAU_900_FARIM');
  });

  it('counts the rest where several share a point', () => {
    expect(labelTextFor('WP_MARKET', ['BAU_900_FARIM', 'VLK_901_HAKON'])).toBe('BAU_900_FARIM +1');
  });

  it('stays one line for the 175 NPCs of a city entrance (§16.22 q4)', () => {
    const crowd = Array.from({ length: 175 }, (_, i) => `VLK_${i}`);
    expect(labelTextFor('NW_CITY_ENTRANCE_01', crowd)).toBe('VLK_0 +174');
  });
});
