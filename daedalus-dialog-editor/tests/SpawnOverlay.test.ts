/**
 * The spawn overlay (level-editor.md §16.19 slice 4).
 *
 * Scene-graph assertions, like `WaynetOverlay.test.ts`: the overlay builds its
 * Three.js objects without a WebGLRenderer, so what would otherwise only be
 * visible in a picture is checkable here.
 *
 * The things that fail silently:
 *
 *   - a spawn point the world has not got must be *dropped*, not drawn. A
 *     missing name resolves to no index, and an unresolved index drawn anyway
 *     is a marker at the world origin — which reads as a spawn in the corner of
 *     the map rather than as a script naming a waypoint that is not there
 *     (which is what the `waypointNotInWorld` rule is for).
 *   - the index is uppercased and the payload's names are not, so a lookup that
 *     forgets the case draws nothing at all on a real world.
 *   - positions stay in ZenGin centimetres: the overlay hangs under the same
 *     mirrored root the waynet and the world do.
 *
 * @jest-environment jsdom
 */

import * as THREE from 'three';
import type { WaynetPayload } from '../src/shared/worldTypes';
import type { SpawnSite } from '../src/shared/types';
import { SpawnOverlay } from '../src/renderer/world/SpawnOverlay';

/** Three waypoints in ZenGin centimetres. Mixed case on purpose — the payload
 *  carries the world's own casing and the spawn index is uppercase. */
function waynet(): WaynetPayload {
  return {
    count: 3,
    names: ['WP_Start', 'WP_Middle', 'FP_Camp'],
    positions: new Float32Array([
      0, 0, 0,
      1000, 200, 1000,
      9000, -50, 3000,
    ]).buffer,
    directions: new Float32Array(9).buffer,
    waterDepths: new Int32Array(3).buffer,
    flags: new Uint32Array(3).buffer,
    edgeCount: 0,
    edges: new Uint32Array([]).buffer,
    danglingEdges: 0,
  };
}

function site(instance: string, spawnPoint: string): SpawnSite {
  return {
    instance,
    spawnPoint,
    filePath: 'C:/Story/Startup.d',
    functionName: 'STARTUP_NEWWORLD',
    line: 12,
  };
}

describe('SpawnOverlay', () => {
  it('draws one marker at each spawn point, in ZenGin space', () => {
    const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')]);
    const positions = overlay.markers.geometry.getAttribute('position');

    // Centimetres, unscaled and unmirrored — the conversion is the scene root.
    expect(positions.count).toBe(1);
    expect([positions.getX(0), positions.getY(0), positions.getZ(0)]).toEqual([1000, 200, 1000]);
  });

  it('draws one marker for a point several NPCs are spawned at', () => {
    // Three NPCs on one waypoint are three markers in the same place: the extra
    // two cost a vertex each and are not distinguishable on screen. Who they
    // are is the waypoint panel's answer (slice 3), not a marker's.
    const overlay = new SpawnOverlay(waynet(), [
      site('GRD_200_XARDAS', 'WP_MIDDLE'),
      site('BAU_961_GAAN', 'WP_MIDDLE'),
      site('MIL_350_MARTIN', 'FP_CAMP'),
    ]);

    expect(overlay.markers.geometry.getAttribute('position').count).toBe(2);
  });

  it('drops a spawn point the world has not got, rather than drawing the origin', () => {
    // A name with no waypoint is a script-locus finding the Problems panel
    // already makes. Drawn here it would be a marker at [0, 0, 0], which looks
    // like a spawn in the corner of the map.
    const overlay = new SpawnOverlay(waynet(), [
      site('GRD_200_XARDAS', 'WP_NOWHERE'),
      site('BAU_961_GAAN', 'WP_START'),
    ]);
    const positions = overlay.markers.geometry.getAttribute('position');

    expect(positions.count).toBe(1);
    expect([positions.getX(0), positions.getY(0), positions.getZ(0)]).toEqual([0, 0, 0]);
  });

  it('matches the uppercase index against the casing the world itself uses', () => {
    // The whole layer is empty on a real world if this is wrong, and empty is
    // exactly what "this project spawns nobody here" looks like.
    const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'FP_CAMP')]);
    const positions = overlay.markers.geometry.getAttribute('position');

    expect(positions.count).toBe(1);
    expect(positions.getX(0)).toBe(9000);
  });

  it('draws through the world, because it is an overlay', () => {
    // A spawn inside a building is exactly the one worth looking at, and it is
    // drawn above the waynet: the two share a position, and the marker is the
    // one carrying the new information.
    const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')]);

    expect((overlay.markers.material as THREE.Material).depthTest).toBe(false);
    expect(overlay.markers.renderOrder).toBeGreaterThan(10);
  });

  it('is hidden until it is asked for', () => {
    const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')]);
    expect(overlay.root.visible).toBe(false);

    overlay.setVisible(true);
    expect(overlay.root.visible).toBe(true);
  });

  it('survives a project that spawns nobody in this world', () => {
    // Not hypothetical: the World surface opens with no script project at all,
    // and an empty index means "nothing is known", never "nothing is there".
    const overlay = new SpawnOverlay(waynet(), []);

    expect(overlay.markers.geometry.getAttribute('position').count).toBe(0);
    expect(() => overlay.refresh()).not.toThrow();
  });

  it('follows a waypoint the payload has moved under it', () => {
    // The markers are a *copy* of the positions — they are a subset, so they
    // cannot be a view over the payload the way the waynet overlay is. A
    // committed waypoint move writes the payload; without this the marker stays
    // where the waypoint used to be, and the two overlays disagree on screen.
    const payload = waynet();
    const overlay = new SpawnOverlay(payload, [site('GRD_200_XARDAS', 'WP_MIDDLE')]);
    const positions = overlay.markers.geometry.getAttribute('position');
    const version = positions.version;

    new Float32Array(payload.positions).set([1400, 50, 900], 1 * 3);
    overlay.refresh();

    expect([positions.getX(0), positions.getY(0), positions.getZ(0)]).toEqual([1400, 50, 900]);
    // `needsUpdate` is write-only — it bumps `version`, which is what the
    // renderer compares. Without it the GPU keeps drawing the old buffer.
    expect(positions.version).toBeGreaterThan(version);
  });

  it('releases its buffers when disposed', () => {
    const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')]);
    let disposed = false;
    overlay.markers.geometry.addEventListener('dispose', () => { disposed = true; });

    overlay.dispose();

    expect(disposed).toBe(true);
    expect(overlay.root.children).toHaveLength(0);
  });
});
