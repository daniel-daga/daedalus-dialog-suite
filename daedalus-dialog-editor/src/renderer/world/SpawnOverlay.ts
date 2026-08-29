import * as THREE from 'three';
import type { WaynetPayload } from '../../shared/worldTypes';
import type { SpawnSite } from '../../shared/types';

// The project's static spawns, drawn over the world (level-editor.md §16.19
// slice 4) — the first thing in Phase 1c a person can see.
//
// Markers, not NPCs: `ProjectIndex` carries instance *names* and no instance
// bodies, so the `B_SetNpcVisual` chain that would resolve a mesh has nothing
// to walk (§16.19). A marker needs only the position, and the position is the
// waypoint the spawn names.
//
// It hangs under the same mirrored root the world mesh, the VOBs and the waynet
// do, so the positions stay exactly as `getWaynet` emitted them — ZenGin
// centimetres, unconverted.
//
// Unlike `WaynetOverlay` this cannot draw straight out of the payload buffer:
// it draws a *subset* of the waypoints, so it holds a copy and the waypoints it
// copied from. `refresh()` re-reads them, which is what keeps a marker on a
// waypoint an applied move has taken somewhere else.

// Warmer and brighter than any waynet colour (blue, orange, green): a marker
// sits on a waypoint, so the two are drawn in the same place whenever both
// layers are on, and the marker is the one carrying the new fact.
const SPAWN = 0xff4081;

// Above the waynet's 10, for the same reason.
const RENDER_ORDER = 11;

export class SpawnOverlay {
  /** Add this under the scene's converted root, not under the scene. */
  readonly root = new THREE.Group();
  readonly markers: THREE.Points;

  private geometry = new THREE.BufferGeometry();
  private material: THREE.PointsMaterial;
  /** The payload's positions, read again on every `refresh`. */
  private source: Float32Array;
  /** The waypoint each marker stands on, in the order they are drawn. */
  private waypoints: number[] = [];

  constructor(waynet: WaynetPayload, sites: readonly SpawnSite[]) {
    this.source = new Float32Array(waynet.positions);

    // The payload keeps the world's own casing; the spawn index is uppercase
    // (`SpawnSite`), and so is every other by-name waypoint lookup on this
    // surface.
    const byName = new Map<string, number>();
    for (let point = 0; point < waynet.count; point++) {
      byName.set(waynet.names[point].toUpperCase(), point);
    }

    // One marker per point, not per site: nine NPCs on one waypoint are nine
    // vertices in the same place, and which of them it is is the waypoint
    // panel's answer rather than a marker's. A spawn point the world has not
    // got is dropped — drawn anyway it would be a marker at the origin, and the
    // `waypointNotInWorld` rule is where that finding belongs.
    const seen = new Set<number>();
    for (const site of sites) {
      const point = byName.get(site.spawnPoint);
      if (point === undefined || seen.has(point)) continue;
      seen.add(point);
      this.waypoints.push(point);
    }

    const positions = new THREE.BufferAttribute(new Float32Array(this.waypoints.length * 3), 3);
    this.geometry.setAttribute('position', positions);
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
    this.markers = new THREE.Points(this.geometry, this.material);
    this.markers.renderOrder = RENDER_ORDER;
    this.markers.matrixAutoUpdate = false;
    this.markers.frustumCulled = false;

    this.root.add(this.markers);
    this.root.matrixAutoUpdate = false;
    // Hidden until asked for, like the waynet: it costs a buffer and a draw call.
    this.root.visible = false;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
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

  private writePositions(): void {
    const attribute = this.geometry.getAttribute('position');
    const target = attribute.array as Float32Array;
    this.waypoints.forEach((point, marker) => {
      target[marker * 3] = this.source[point * 3];
      target[marker * 3 + 1] = this.source[point * 3 + 1];
      target[marker * 3 + 2] = this.source[point * 3 + 2];
    });
    attribute.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.root.clear();
  }
}
