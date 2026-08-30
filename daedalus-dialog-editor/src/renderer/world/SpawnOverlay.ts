import * as THREE from 'three';
import type { WaynetPayload } from '../../shared/worldTypes';
import type { SpawnSite } from '../../shared/types';
import { placementWaypointsAt, type RoutineIndex } from '../routines/routineSchedule';

// The project's static spawns, drawn over the world (level-editor.md §16.19
// slice 4) — and, once a time is set, where the daily routines put the NPCs
// instead (slice 5).
//
// Markers, not NPCs: `ProjectIndex` carries instance *names* and no instance
// bodies, so the `B_SetNpcVisual` chain that would resolve a mesh has nothing
// to walk (§16.19). A marker needs only the position, and the position is the
// waypoint the spawn — or the routine entry — names.
//
// It hangs under the same mirrored root the world mesh, the VOBs and the waynet
// do, so the positions stay exactly as `getWaynet` emitted them — ZenGin
// centimetres, unconverted.
//
// Unlike `WaynetOverlay` this cannot draw straight out of the payload buffer:
// it draws a *subset* of the waypoints, so it holds a copy and the waypoints it
// copied from. `refresh()` re-reads them, which is what keeps a marker on a
// waypoint an applied move has taken somewhere else.
//
// **Two layers, because a time splits the NPCs three ways and only one of the
// three is a stated position.** `markers` is what the script says: the static
// spawns with no time set, the routine placements with one. `unknownMarkers` is
// the fallback — an NPC whose routine has a hole at this minute, or who
// declares no routine at all, drawn at the spawn he was *inserted* at. Merged
// into one layer those two would be indistinguishable and the weaker fact would
// read as the stronger. `placementWaypointsAt` is where the split is decided;
// this class only resolves names to points and draws them.

// Warmer and brighter than any waynet colour (blue, orange, green): a marker
// sits on a waypoint, so the two are drawn in the same place whenever both
// layers are on, and the marker is the one carrying the new fact.
const SPAWN = 0xff4081;

// The fallback layer. Desaturated and darker so it reads as secondary at a
// glance without disappearing — it is still a real NPC at a real waypoint, just
// not one this minute has an answer for.
const UNPLACED = 0x78909c;

// Above the waynet's 10, for the same reason.
const RENDER_ORDER = 11;

export class SpawnOverlay {
  /** Add this under the scene's converted root, not under the scene. */
  readonly root = new THREE.Group();
  /** Where the script states an NPC is: static spawns, or routine placements. */
  readonly markers: THREE.Points;
  /** Static spawns of the NPCs this minute has no stated position for. */
  readonly unknownMarkers: THREE.Points;

  private geometry = new THREE.BufferGeometry();
  private unknownGeometry = new THREE.BufferGeometry();
  private material: THREE.PointsMaterial;
  private unknownMaterial: THREE.PointsMaterial;
  /** The payload's positions, read again on every `refresh`. */
  private source: Float32Array;
  /** UPPERCASED waypoint name to its index in the payload. */
  private byName = new Map<string, number>();
  /** The static spawn points, deduplicated — what a null minute draws. */
  private staticPoints: number[] = [];
  /** The waypoints each layer stands on, in the order they are drawn. */
  private points: number[] = [];
  private unknownPoints: number[] = [];

  constructor(
    waynet: WaynetPayload,
    private sites: readonly SpawnSite[],
    private routines: RoutineIndex,
  ) {
    this.source = new Float32Array(waynet.positions);

    // The payload keeps the world's own casing; the spawn index is uppercase
    // (`SpawnSite`), and so is every other by-name waypoint lookup on this
    // surface.
    for (let point = 0; point < waynet.count; point++) {
      this.byName.set(waynet.names[point].toUpperCase(), point);
    }

    // One marker per point, not per site: nine NPCs on one waypoint are nine
    // vertices in the same place, and which of them it is is the waypoint
    // panel's answer rather than a marker's. A spawn point the world has not
    // got is dropped — drawn anyway it would be a marker at the origin, and the
    // `waypointNotInWorld` rule is where that finding belongs.
    this.staticPoints = this.resolve(sites.map((site) => site.spawnPoint));
    this.points = this.staticPoints;

    // Allocated once at the world's waypoint count — an upper bound on either
    // layer, since every drawn marker stands on a waypoint — and drawn as a
    // range inside it. The slider rewrites both sets on every tick of a drag,
    // and replacing the attribute instead would orphan its GPU buffer each
    // time: `WebGLAttributes` frees one on the attribute's own dispose event,
    // which a replaced attribute never fires.
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(waynet.count * 3), 3),
    );
    this.unknownGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(waynet.count * 3), 3),
    );
    this.writePositions();

    this.material = new THREE.PointsMaterial({
      // Larger than the waynet's 3.5: a spawn is rare where a waypoint is
      // everywhere, and it has to be findable with the whole world in frame.
      size: 9,
      // Pixels, not world units — a marker has no size, and one that shrinks
      // with distance is invisible from the viewpoint that shows the map.
      sizeAttenuation: false,
      color: SPAWN,
      // A spawn inside a building is exactly the one worth looking at.
      depthTest: false,
      transparent: true,
    });
    // Smaller as well as duller: two markers on neighbouring waypoints should
    // be separable at a glance, and size is the difference that survives being
    // colour-blind.
    this.unknownMaterial = new THREE.PointsMaterial({
      size: 6,
      sizeAttenuation: false,
      color: UNPLACED,
      depthTest: false,
      transparent: true,
      opacity: 0.75,
    });

    this.markers = this.buildPoints(this.geometry, this.material);
    this.unknownMarkers = this.buildPoints(this.unknownGeometry, this.unknownMaterial);

    this.root.add(this.markers);
    this.root.add(this.unknownMarkers);
    this.root.matrixAutoUpdate = false;
    // Hidden until asked for, like the waynet: it costs a buffer and a draw call.
    this.root.visible = false;
  }

  private buildPoints(geometry: THREE.BufferGeometry, material: THREE.PointsMaterial): THREE.Points {
    const points = new THREE.Points(geometry, material);
    points.renderOrder = RENDER_ORDER;
    points.matrixAutoUpdate = false;
    points.frustumCulled = false;
    return points;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /**
   * Every waypoint this layer currently draws a marker on, both colours.
   *
   * The name layer labels what is drawn and not the whole waynet: with only
   * this layer on, a name over a waypoint carrying no marker is a name over
   * nothing. Both lists, because an NPC the scripts leave unplaced is still an
   * NPC somebody wants to find.
   */
  get labelledPoints(): number[] {
    return [...this.points, ...this.unknownPoints];
  }

  /**
   * Draw the world as the scripts describe it at `minute`, or `null` for the
   * static spawns the layer has always drawn.
   *
   * Null is the slider switched off, not midnight — an NPC's position at 00:00
   * is a thing the routines answer, and "no time chosen" is not.
   */
  setTime(minute: number | null): void {
    if (minute === null) {
      this.points = this.staticPoints;
      this.unknownPoints = [];
    } else {
      const placements = placementWaypointsAt(this.routines, this.sites, minute);
      this.points = this.resolve(placements.known);
      this.unknownPoints = this.resolve(placements.unknown);
    }
    this.writePositions();
  }

  /**
   * Read the waypoint positions again, after something outside wrote them.
   *
   * That something is the World surface applying a committed waypoint move — or
   * an undo, or a redo — to the payload through `zen-world`'s
   * `applyWaypointPositions`, the same write the waynet overlay answers with its
   * own `refresh`. Without it a marker stays where the waypoint used to be and
   * the two overlays disagree on screen.
   */
  refresh(): void {
    this.writePositions();
  }

  /** Waypoint names to payload indices, dropping the unknown and the repeated. */
  private resolve(names: readonly string[]): number[] {
    const seen = new Set<number>();
    const points: number[] = [];
    for (const name of names) {
      const point = this.byName.get(name);
      if (point === undefined || seen.has(point)) continue;
      seen.add(point);
      points.push(point);
    }
    return points;
  }

  private writePositions(): void {
    this.writeLayer(this.geometry, this.points);
    this.writeLayer(this.unknownGeometry, this.unknownPoints);
  }

  private writeLayer(geometry: THREE.BufferGeometry, points: readonly number[]): void {
    const attribute = geometry.getAttribute('position');
    const target = attribute.array as Float32Array;
    points.forEach((point, marker) => {
      target[marker * 3] = this.source[point * 3];
      target[marker * 3 + 1] = this.source[point * 3 + 1];
      target[marker * 3 + 2] = this.source[point * 3 + 2];
    });
    attribute.needsUpdate = true;
    geometry.setDrawRange(0, points.length);
    // Fitted over the whole attribute, not the drawn range — `three` has no
    // range-aware form — so the slots past the range, holding zeroes or what a
    // longer set left there, make it loose. Harmless here and only here: these
    // layers set `frustumCulled = false`, so nothing ever tests the sphere.
    geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.geometry.dispose();
    this.unknownGeometry.dispose();
    this.material.dispose();
    this.unknownMaterial.dispose();
    this.root.clear();
  }
}
