import * as THREE from 'three';
import type { WaynetPayload } from '../../shared/worldTypes';
import type { RoutineEntry } from '../routines/routineEntries';
import { routineColor } from '../routines/routineDraft';
import { waynetRoute, type WaynetGraph } from '../routines/waynetRoute';

// A routine draft drawn over the world (npc-editor.md §6): a stop at each
// activity's waypoint, and the way between consecutive stops of the day along
// the waynet. It hangs under the scene's mirrored root like the waynet, so its
// positions are the waynet's own, ZenGin centimetres.
//
// A leg the waynet has no route for is drawn straight and dashed, and named —
// a straight solid line would look like a way the NPC can walk. What the
// engine does with such a leg is unmeasured; this only says the waynet has no
// route.
//
// Built per draft rather than updated in place: a draft has a handful of
// stops, and every edit can change all of them.

const UNROUTED = 0xff7043;
const RENDER_ORDER = 11;

export class RoutineOverlay {
  /** Add this under the scene's converted root, not under the scene. */
  readonly root = new THREE.Group();
  readonly stops: THREE.Points;
  readonly selectedStop: THREE.Points;
  readonly routes: THREE.LineSegments;
  readonly unrouted: THREE.LineSegments;
  /** Legs with no waynet route, as the waypoint names at either end. */
  readonly unroutedLegs: Array<[string, string]> = [];
  /** Stop waypoints the waynet does not have, as the draft names them. */
  readonly missing: string[] = [];

  constructor(waynet: WaynetPayload, graph: WaynetGraph, entries: readonly RoutineEntry[], selected: number | null) {
    const positions = new Float32Array(waynet.positions);
    const at = (waypoint: number) => [positions[waypoint * 3], positions[waypoint * 3 + 1], positions[waypoint * 3 + 2]];
    const indexOf = (name: string) => graph.byName.get(name.toUpperCase());

    const stopPositions: number[] = [];
    const stopColors: number[] = [];
    entries.forEach((entry, i) => {
      const waypoint = indexOf(entry.waypoint);
      if (waypoint === undefined) {
        this.missing.push(entry.waypoint);
        return;
      }
      stopPositions.push(...at(waypoint));
      stopColors.push(...new THREE.Color(routineColor(i)).toArray());
    });
    const chosen = selected === null ? undefined : entries[selected];
    const chosenWaypoint = chosen && indexOf(chosen.waypoint);

    // The day in order of start, and back round to its first stop.
    const day = [...entries].sort((a, b) => a.startMinute - b.startMinute)
      .filter((entry) => indexOf(entry.waypoint) !== undefined);
    const routed: number[] = [];
    const straight: number[] = [];
    if (day.length > 1) {
      day.forEach((from, i) => {
        const to = day[(i + 1) % day.length];
        const route = waynetRoute(graph, from.waypoint, to.waypoint);
        if (route === null) {
          straight.push(...at(indexOf(from.waypoint)!), ...at(indexOf(to.waypoint)!));
          this.unroutedLegs.push([from.waypoint, to.waypoint]);
          return;
        }
        for (let step = 0; step + 1 < route.length; step++) routed.push(...at(route[step]), ...at(route[step + 1]));
      });
    }

    this.stops = points(stopPositions, 10, stopColors);
    this.selectedStop = points(chosenWaypoint === undefined ? [] : at(chosenWaypoint), 18);
    this.routes = lines(routed, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
    this.unrouted = lines(straight, new THREE.LineDashedMaterial({
      color: UNROUTED, dashSize: 150, gapSize: 100, depthTest: false, transparent: true,
    }));
    this.unrouted.computeLineDistances();

    this.root.add(this.routes, this.unrouted, this.stops, this.selectedStop);
    this.root.matrixAutoUpdate = false;
  }

  dispose(): void {
    for (const object of [this.stops, this.selectedStop, this.routes, this.unrouted]) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
    this.root.clear();
  }
}

function points(positions: number[], size: number, colors?: number[]): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  const material = new THREE.PointsMaterial({
    size, sizeAttenuation: false, depthTest: false, transparent: true,
    ...(colors ? { vertexColors: true } : { color: 0xffffff, opacity: 0.5 }),
  });
  const object = new THREE.Points(geometry, material);
  object.renderOrder = RENDER_ORDER;
  object.frustumCulled = false;
  return object;
}

function lines(positions: number[], material: THREE.LineBasicMaterial | THREE.LineDashedMaterial): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  const object = new THREE.LineSegments(geometry, material);
  object.renderOrder = RENDER_ORDER;
  object.frustumCulled = false;
  return object;
}
