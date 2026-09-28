/**
 * The routine draft drawn over the world (npc-editor.md §6): a stop at each
 * activity's waypoint, in the activity's colour, and the way between
 * consecutive stops along the waynet — so a stop the waynet cannot reach shows
 * as a dashed straight line rather than as a route that looks walkable.
 *
 * Scene-graph assertions, like `WaynetOverlay.test.ts`: positions stay in
 * ZenGin space because the overlay hangs under the same mirrored root.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import { RoutineOverlay } from '../src/renderer/world/RoutineOverlay';
import { ROUTINE_COLORS } from '../src/renderer/routines/routineDraft';
import { waynetGraph } from '../src/renderer/routines/waynetRoute';
import type { RoutineEntry } from '../src/renderer/routines/routineEntries';
import type { WaynetPayload } from '../src/shared/worldTypes';

/** A–B–C and the shorter A–D–C; E joined to nothing. */
function waynet(): WaynetPayload {
  const names = ['WP_A', 'WP_B', 'WP_C', 'WP_D', 'WP_E'];
  return {
    count: names.length,
    names,
    positions: new Float32Array([
      0, 0, 0,
      1000, 0, 800,
      2000, 0, 0,
      1000, 0, 100,
      9000, 0, 9000,
    ]).buffer,
    directions: new Float32Array(names.length * 3).buffer,
    waterDepths: new Int32Array(names.length).buffer,
    flags: new Uint32Array(names.length).buffer,
    edgeCount: 4,
    edges: new Uint32Array([0, 1, 1, 2, 0, 3, 3, 2]).buffer,
    danglingEdges: 0,
  };
}

const h = (hour: number) => hour * 60;
const entry = (waypoint: string, start: number, end: number): RoutineEntry =>
  ({ state: 'TA_Stand', startMinute: start, endMinute: end, waypoint });

const vertices = (object: THREE.Points | THREE.LineSegments) =>
  Array.from(object.geometry.getAttribute('position').array as Float32Array);

function build(entries: RoutineEntry[], selected: number | null = null) {
  const payload = waynet();
  return new RoutineOverlay(payload, waynetGraph(payload), entries, selected);
}

describe('RoutineOverlay', () => {
  it('puts a stop at each activity\'s waypoint, in ZenGin space, in the activity\'s colour', () => {
    const overlay = build([entry('wp_a', h(7), h(22)), entry('WP_C', h(22), h(7))]);

    expect(vertices(overlay.stops)).toEqual([0, 0, 0, 2000, 0, 0]);
    const colors = Array.from(overlay.stops.geometry.getAttribute('color').array as Float32Array);
    const expected = [0, 1].flatMap((i) => new THREE.Color(ROUTINE_COLORS[i]).toArray());
    expect(colors).toEqual(expected.map((c) => Math.fround(c)));
  });

  it('draws the way between consecutive stops along the waynet, round the day and back', () => {
    // Day order is by start time, not list order: C at 06:00 comes first.
    const overlay = build([entry('WP_A', h(7), h(22)), entry('WP_C', h(6), h(7))]);

    // C→A, then A→C to close the day; each over D, the shorter way.
    expect(vertices(overlay.routes)).toEqual([
      2000, 0, 0, 1000, 0, 100, 1000, 0, 100, 0, 0, 0,
      0, 0, 0, 1000, 0, 100, 1000, 0, 100, 2000, 0, 0,
    ]);
    expect(overlay.unroutedLegs).toEqual([]);
  });

  it('draws a leg the waynet cannot route as a straight dashed line, and names it', () => {
    const overlay = build([entry('WP_A', h(8), h(20)), entry('WP_E', h(20), h(8))]);

    expect(vertices(overlay.routes)).toEqual([]);
    expect(vertices(overlay.unrouted)).toEqual([0, 0, 0, 9000, 0, 9000, 9000, 0, 9000, 0, 0, 0]);
    expect(overlay.unrouted.material).toBeInstanceOf(THREE.LineDashedMaterial);
    expect(overlay.unroutedLegs).toEqual([['WP_A', 'WP_E'], ['WP_E', 'WP_A']]);
  });

  it('leaves out a stop whose waypoint the waynet does not have, and names it', () => {
    const overlay = build([entry('WP_A', h(8), h(20)), entry('WP_NOWHERE', h(20), h(8))]);

    expect(vertices(overlay.stops)).toEqual([0, 0, 0]);
    expect(overlay.missing).toEqual(['WP_NOWHERE']);
    expect(vertices(overlay.routes)).toEqual([]);
  });

  it('marks the selected activity\'s stop, and nothing when none is selected', () => {
    expect(vertices(build([entry('WP_A', h(8), h(20)), entry('WP_C', h(20), h(8))], 1).selectedStop))
      .toEqual([2000, 0, 0]);
    expect(vertices(build([entry('WP_A', 0, 0)]).selectedStop)).toEqual([]);
  });

  it('draws over the world, like the waynet it sits on', () => {
    const overlay = build([entry('WP_A', h(8), h(20)), entry('WP_C', h(20), h(8))]);
    for (const object of [overlay.stops, overlay.selectedStop, overlay.routes, overlay.unrouted]) {
      expect((object.material as THREE.Material).depthTest).toBe(false);
    }
  });
});
