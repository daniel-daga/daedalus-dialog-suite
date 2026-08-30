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
import type { RoutineSite, SpawnSite } from '../src/shared/types';
import { SpawnOverlay } from '../src/renderer/world/SpawnOverlay';

/**
 * How many markers a layer actually draws.
 *
 * Not `position.count`: the buffers are allocated once at the waynet's size and
 * the drawn set is a range inside them, because the time slider rewrites that
 * set on every tick of a drag and replacing the attribute instead would orphan
 * a GPU buffer each time.
 */
const drawn = (points: THREE.Points) => points.geometry.drawRange.count;

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

function entry(routine: string, startMinute: number, endMinute: number, waypoint: string): RoutineSite {
  return { routine, startMinute, endMinute, waypoint, filePath: 'C:/Story/Rtn.d', line: 3 };
}

/** No routines at all — the static case, and what every pre-slider test wants. */
const NO_ROUTINES = { sites: [] as RoutineSite[], routinesByNpc: {} };

const at = (hour: number) => hour * 60;

describe('SpawnOverlay', () => {
  it('draws one marker at each spawn point, in ZenGin space', () => {
    const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);
    const positions = overlay.markers.geometry.getAttribute('position');

    // Centimetres, unscaled and unmirrored — the conversion is the scene root.
    expect(drawn(overlay.markers)).toBe(1);
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
    ], NO_ROUTINES);

    expect(drawn(overlay.markers)).toBe(2);
  });

  it('drops a spawn point the world has not got, rather than drawing the origin', () => {
    // A name with no waypoint is a script-locus finding the Problems panel
    // already makes. Drawn here it would be a marker at [0, 0, 0], which looks
    // like a spawn in the corner of the map.
    const overlay = new SpawnOverlay(waynet(), [
      site('GRD_200_XARDAS', 'WP_NOWHERE'),
      site('BAU_961_GAAN', 'WP_START'),
    ], NO_ROUTINES);
    const positions = overlay.markers.geometry.getAttribute('position');

    expect(drawn(overlay.markers)).toBe(1);
    expect([positions.getX(0), positions.getY(0), positions.getZ(0)]).toEqual([0, 0, 0]);
  });

  it('matches the uppercase index against the casing the world itself uses', () => {
    // The whole layer is empty on a real world if this is wrong, and empty is
    // exactly what "this project spawns nobody here" looks like.
    const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'FP_CAMP')], NO_ROUTINES);
    const positions = overlay.markers.geometry.getAttribute('position');

    expect(drawn(overlay.markers)).toBe(1);
    expect(positions.getX(0)).toBe(9000);
  });

  it('draws through the world, because it is an overlay', () => {
    // A spawn inside a building is exactly the one worth looking at, and it is
    // drawn above the waynet: the two share a position, and the marker is the
    // one carrying the new information.
    const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);

    expect((overlay.markers.material as THREE.Material).depthTest).toBe(false);
    expect(overlay.markers.renderOrder).toBeGreaterThan(10);
  });

  it('is hidden until it is asked for', () => {
    const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);
    expect(overlay.root.visible).toBe(false);

    overlay.setVisible(true);
    expect(overlay.root.visible).toBe(true);
  });

  it('survives a project that spawns nobody in this world', () => {
    // Not hypothetical: the World surface opens with no script project at all,
    // and an empty index means "nothing is known", never "nothing is there".
    const overlay = new SpawnOverlay(waynet(), [], NO_ROUTINES);

    expect(drawn(overlay.markers)).toBe(0);
    expect(() => overlay.refresh()).not.toThrow();
  });

  it('follows a waypoint the payload has moved under it', () => {
    // The markers are a *copy* of the positions — they are a subset, so they
    // cannot be a view over the payload the way the waynet overlay is. A
    // committed waypoint move writes the payload; without this the marker stays
    // where the waypoint used to be, and the two overlays disagree on screen.
    const payload = waynet();
    const overlay = new SpawnOverlay(payload, [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);
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
    const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);
    let disposed = false;
    overlay.markers.geometry.addEventListener('dispose', () => { disposed = true; });

    overlay.dispose();

    expect(disposed).toBe(true);
    expect(overlay.root.children).toHaveLength(0);
  });

  describe('under a set time (§16.19 slice 5, the slider)', () => {
    // The routine puts Farim in the market by day and in bed at night, and the
    // static spawn is neither: `Wld_InsertNpc` is where he was *inserted*, so a
    // time that the routine covers must move the marker off it entirely.
    const ROUTINES = {
      sites: [
        entry('RTN_START_FARIM', at(8), at(22), 'WP_MIDDLE'),
        entry('RTN_START_FARIM', at(22), at(23), 'FP_CAMP'),
      ],
      routinesByNpc: { BAU_900_FARIM: 'RTN_START_FARIM' },
    };
    const SPAWNS = [site('BAU_900_FARIM', 'WP_START')];

    it('draws the static spawns while no time is set', () => {
      // The default, and what the layer has always done: a null minute is the
      // slider switched off, not midnight.
      const overlay = new SpawnOverlay(waynet(), SPAWNS, ROUTINES);

      expect(drawn(overlay.markers)).toBe(1);
      expect(overlay.markers.geometry.getAttribute('position').getX(0)).toBe(0);
      expect(drawn(overlay.unknownMarkers)).toBe(0);
    });

    it('moves the marker to where the routine puts him', () => {
      const overlay = new SpawnOverlay(waynet(), SPAWNS, ROUTINES);

      overlay.setTime(at(12));

      expect(drawn(overlay.markers)).toBe(1);
      // WP_MIDDLE, not the WP_START he was inserted at.
      expect(overlay.markers.geometry.getAttribute('position').getX(0)).toBe(1000);
      expect(drawn(overlay.unknownMarkers)).toBe(0);
    });

    it('falls back to the static spawn, in the other layer, where the routine is silent', () => {
      // 02:00 is the hole between the two entries. Drawing him at WP_START in
      // the same colour would assert the script says he is there, which it does
      // not — the second layer is the whole point of the split.
      const overlay = new SpawnOverlay(waynet(), SPAWNS, ROUTINES);

      overlay.setTime(at(2));

      expect(drawn(overlay.markers)).toBe(0);
      expect(drawn(overlay.unknownMarkers)).toBe(1);
      expect(overlay.unknownMarkers.geometry.getAttribute('position').getX(0)).toBe(0);
    });

    it('tells the two layers apart on screen', () => {
      // If they draw identically the split is invisible and the whole
      // known/unknown distinction is a lie the user cannot see.
      const overlay = new SpawnOverlay(waynet(), SPAWNS, ROUTINES);
      const known = overlay.markers.material as THREE.PointsMaterial;
      const unsure = overlay.unknownMarkers.material as THREE.PointsMaterial;

      expect(unsure.color.getHex()).not.toBe(known.color.getHex());
      // And it still draws through walls, like everything else on this layer.
      expect(unsure.depthTest).toBe(false);
    });

    it('goes back to the static spawns when the time is cleared', () => {
      const overlay = new SpawnOverlay(waynet(), SPAWNS, ROUTINES);
      overlay.setTime(at(12));

      overlay.setTime(null);

      expect(drawn(overlay.markers)).toBe(1);
      expect(overlay.markers.geometry.getAttribute('position').getX(0)).toBe(0);
      expect(drawn(overlay.unknownMarkers)).toBe(0);
    });

    it('drops a routine waypoint this world has not got', () => {
      // The same rule the static markers follow, and the reason nothing filters
      // routines by world anywhere else: an unresolved name drawn anyway is a
      // marker at the origin.
      const overlay = new SpawnOverlay(waynet(), [], {
        sites: [entry('RTN_ELSEWHERE', 0, 0, 'WP_OTHER_WORLD')],
        routinesByNpc: { SOME_NPC: 'RTN_ELSEWHERE' },
      });

      overlay.setTime(at(12));

      expect(drawn(overlay.markers)).toBe(0);
    });

    it('follows a waypoint the payload has moved under a set time', () => {
      // `refresh` re-reads positions for both layers, not just the static one —
      // a committed waypoint move under an open slider otherwise leaves the
      // marker behind exactly as it would without a slider.
      const payload = waynet();
      const overlay = new SpawnOverlay(payload, SPAWNS, ROUTINES);
      overlay.setTime(at(12));

      new Float32Array(payload.positions).set([1400, 50, 900], 1 * 3);
      overlay.refresh();

      expect(overlay.markers.geometry.getAttribute('position').getX(0)).toBe(1400);
    });

    it('releases both layers when disposed', () => {
      const overlay = new SpawnOverlay(waynet(), SPAWNS, ROUTINES);
      let disposed = false;
      overlay.unknownMarkers.geometry.addEventListener('dispose', () => { disposed = true; });

      overlay.dispose();

      expect(disposed).toBe(true);
    });
  });
});
