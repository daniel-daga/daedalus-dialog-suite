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

// The dummy — a body standing where the dot already is (slice 9). Roughly a
// person's height in ZenGin centimetres: a 25 cm radius and a 130 cm cylinder
// between the two hemispherical caps add up to 180.
const DUMMY_RADIUS = 25;
const DUMMY_CYLINDER_HEIGHT = 130;
const DUMMY_HEIGHT = DUMMY_CYLINDER_HEIGHT + 2 * DUMMY_RADIUS;

const DUMMY_KNOWN_COLOR = new THREE.Color(SPAWN);
const DUMMY_UNKNOWN_COLOR = new THREE.Color(UNPLACED);

export class SpawnOverlay {
  /** Add this under the scene's converted root, not under the scene. */
  readonly root = new THREE.Group();
  /** Where the script states an NPC is: static spawns, or routine placements. */
  readonly markers: THREE.Points;
  /** Static spawns of the NPCs this minute has no stated position for. */
  readonly unknownMarkers: THREE.Points;
  /**
   * A body at each occupied point (§16.19 slice 9) — one `InstancedMesh`, known
   * and unknown together, told apart by instance colour rather than a second
   * mesh, the way `HIDDEN_ATTRIBUTE` already carries a per-instance flag beside
   * a VOB's matrix. It stands beside the dot, not instead of it: the dot keeps
   * `depthTest: false` and a fixed pixel size on purpose, and a solid body can
   * hold neither property without hiding a spawn behind a wall or vanishing at
   * map zoom.
   *
   * Symmetric on purpose — no rotation is ever written. `WaynetPayload.directions`
   * has no confirmed consumer and the mirrored root turns a wrong facing into a
   * mirrored one, so until that is checked against Spacer (as §16.4's Euler
   * order is) a facing this draws would claim more than it can back.
   */
  readonly dummies: THREE.InstancedMesh;

  private geometry = new THREE.BufferGeometry();
  private unknownGeometry = new THREE.BufferGeometry();
  private material: THREE.PointsMaterial;
  private unknownMaterial: THREE.PointsMaterial;
  private dummyGeometry: THREE.CapsuleGeometry;
  private dummyMaterial: THREE.MeshBasicMaterial;
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

    // Capped at the person's own height, feet at the origin: `setMatrixAt`
    // below writes a pure translation to the waypoint, so the offset that puts
    // the feet there rather than the capsule's centre has to live in the
    // geometry itself. Baked once here rather than composed into every
    // instance matrix, the way slice 4's markers bake nothing because a point
    // has no extent to offset.
    this.dummyGeometry = new THREE.CapsuleGeometry(DUMMY_RADIUS, DUMMY_CYLINDER_HEIGHT, 4, 8);
    this.dummyGeometry.translate(0, DUMMY_HEIGHT / 2, 0);
    // White, because the material colour and the instance colour are
    // multiplied and the instance's is the one carrying the split.
    //
    // **`vertexColors` stays off, and that is load-bearing.** `instanceColor`
    // on its own is the whole mechanism: three defines `USE_INSTANCING_COLOR`
    // in the vertex shader from the attribute merely being present, and
    // `USE_COLOR` in the *fragment* shader from `vertexColors ||
    // instancingColor`, so the multiply into `diffuseColor` already happens.
    // Setting it as well would additionally declare `attribute vec3 color` in
    // the *vertex* shader and multiply by that — an attribute a capsule has
    // not got, and one `MeshBasicMaterial` cannot supply a default for, since
    // `defaultAttributeValues` is `ShaderMaterial`'s alone. The generic value
    // stays at WebGL's (0, 0, 0, 1) and every dummy draws **black**, which no
    // test here can see: `getColorAt` reads the buffer back, not the shader.
    this.dummyMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.dummies = new THREE.InstancedMesh(this.dummyGeometry, this.dummyMaterial, waynet.count);
    this.dummies.matrixAutoUpdate = false;
    // Nothing raycasts an overlay decoration: the World surface picks a
    // waypoint by projecting its origin (`pickWaypoint`), never by a mesh hit,
    // and a stray hit here would only ever be a bug in something else's cast.
    this.dummies.raycast = () => undefined;

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
    this.root.add(this.dummies);
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
   *
   * `state` is the quest-state lens (§16.19 slice 13): an NPC with a variant for
   * it is drawn through that variant, everyone else through his declared day.
   * It rides this call rather than one of its own because a state without a
   * minute answers nothing the static layer does not.
   */
  setTime(minute: number | null, state: string | null = null): void {
    if (minute === null) {
      this.points = this.staticPoints;
      this.unknownPoints = [];
    } else {
      const placements = placementWaypointsAt(this.routines, this.sites, minute, state);
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
    this.writeDummies();
  }

  /**
   * One instance per point in either list, known first — the same set the two
   * dot layers draw, told apart by colour rather than by which of two meshes
   * they are in (the `HIDDEN_ATTRIBUTE` pattern, not the markers' two-`Points`
   * one, because a body is one draw call either way and a second `InstancedMesh`
   * would only double the buffers).
   */
  private writeDummies(): void {
    const matrix = new THREE.Matrix4();
    let instance = 0;

    const write = (points: readonly number[], color: THREE.Color) => {
      for (const point of points) {
        matrix.setPosition(this.source[point * 3], this.source[point * 3 + 1], this.source[point * 3 + 2]);
        this.dummies.setMatrixAt(instance, matrix);
        this.dummies.setColorAt(instance, color);
        instance += 1;
      }
    };
    write(this.points, DUMMY_KNOWN_COLOR);
    write(this.unknownPoints, DUMMY_UNKNOWN_COLOR);

    this.dummies.count = instance;
    this.dummies.instanceMatrix.needsUpdate = true;
    // `setColorAt` allocates `instanceColor` on its first call, so a world with
    // nobody drawn here yet — nothing spawned, or the layer just built — never
    // has one to flag stale.
    if (this.dummies.instanceColor) this.dummies.instanceColor.needsUpdate = true;
    this.dummies.computeBoundingSphere();
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
    this.dummyGeometry.dispose();
    this.dummyMaterial.dispose();
    this.root.clear();
  }
}
