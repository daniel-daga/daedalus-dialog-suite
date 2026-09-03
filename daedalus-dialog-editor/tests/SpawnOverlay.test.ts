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
import { markerDotTexture } from '../src/renderer/world/markerSprite';

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

    // §16.19 slice 13 — the State lens reaches the layer through the same call
    // the slider uses, because a state without a minute answers nothing the
    // static layer does not.
    it('draws the state variant when one is chosen, and the declared day otherwise', () => {
      const routines = {
        sites: [
          ...ROUTINES.sites,
          entry('RTN_TOT_900', 0, 0, 'FP_CAMP'),
        ],
        routinesByNpc: ROUTINES.routinesByNpc,
        statesByNpc: { BAU_900_FARIM: { id: 900, states: { TOT: 'RTN_TOT_900' } } },
      };
      const overlay = new SpawnOverlay(waynet(), SPAWNS, routines);

      overlay.setTime(at(12), 'TOT');
      expect(drawn(overlay.markers)).toBe(1);
      // FP_CAMP, the variant's waypoint — not WP_MIDDLE, the declared one.
      expect(overlay.markers.geometry.getAttribute('position').getX(0)).toBe(9000);

      overlay.setTime(at(12), null);
      expect(overlay.markers.geometry.getAttribute('position').getX(0)).toBe(1000);
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

    it('draws both layers as the shared rimmed pip, not as bare squares', () => {
      // A marker sits over terrain of any brightness, and an unrimmed square in
      // the layer's own colour is lost against half of it. The texture is the
      // app's one copy: disposing the overlay must not take it with it, or the
      // next world's markers upload it again.
      const overlay = new SpawnOverlay(waynet(), SPAWNS, ROUTINES);
      const sprite = markerDotTexture();

      expect((overlay.markers.material as THREE.PointsMaterial).map).toBe(sprite);
      expect((overlay.unknownMarkers.material as THREE.PointsMaterial).map).toBe(sprite);

      const disposed = jest.spyOn(sprite, 'dispose');
      overlay.dispose();
      expect(disposed).not.toHaveBeenCalled();
      disposed.mockRestore();
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

  describe('NPC dummies (§16.19 slice 9)', () => {
    // A body at each occupied point, standing beside the dot that has always
    // been there — not instead of it (§16.19 slice 9, decision 2): the dot is
    // what makes a spawn findable with the whole map in frame, and a solid body
    // cannot keep that property.

    it('draws one dummy at each occupied point, feet on the waypoint', () => {
      const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);

      expect(overlay.dummies.count).toBe(1);
      const matrix = new THREE.Matrix4();
      overlay.dummies.getMatrixAt(0, matrix);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      matrix.decompose(position, quaternion, scale);
      // The waypoint's own position, unshifted — the visual offset that puts
      // the capsule's feet there rather than its centre is baked into the
      // geometry, not the instance matrix.
      expect([position.x, position.y, position.z]).toEqual([1000, 200, 1000]);
    });

    it('is symmetric — no rotation is written, because the facing is unverified', () => {
      // level-editor.md §16.19 slice 9, decision 1: `WaynetPayload.directions`
      // is read by nothing and the mirrored root turns a wrong facing into a
      // reflection too. A symmetric dummy claims nothing it cannot back.
      const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);

      const matrix = new THREE.Matrix4();
      overlay.dummies.getMatrixAt(0, matrix);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      matrix.decompose(position, quaternion, scale);

      expect(quaternion.equals(new THREE.Quaternion())).toBe(true);
    });

    it('draws one dummy per point, not per site', () => {
      const overlay = new SpawnOverlay(waynet(), [
        site('GRD_200_XARDAS', 'WP_MIDDLE'),
        site('BAU_961_GAAN', 'WP_MIDDLE'),
        site('MIL_350_MARTIN', 'FP_CAMP'),
      ], NO_ROUTINES);

      expect(overlay.dummies.count).toBe(2);
    });

    it('drops a spawn point the world has not got', () => {
      const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_NOWHERE')], NO_ROUTINES);

      expect(overlay.dummies.count).toBe(0);
    });

    it('draws through walls like the dot, but the dummy does not', () => {
      // Decision 2: the dot keeps `depthTest: false` on purpose — a spawn
      // inside a building is exactly the one worth looking at — and a solid
      // body that ignored depth would read as standing in front of the
      // building instead. The dummy is depth-tested; the dot is untouched.
      const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);

      expect((overlay.dummies.material as THREE.Material).depthTest).toBe(true);
      expect((overlay.markers.material as THREE.Material).depthTest).toBe(false);
    });

    it('colours a dummy by the same known/unknown split as the dots', () => {
      const ROUTINES = {
        sites: [entry('RTN_START_FARIM', at(8), at(22), 'WP_MIDDLE')],
        routinesByNpc: { BAU_900_FARIM: 'RTN_START_FARIM' },
      };
      const overlay = new SpawnOverlay(waynet(), [site('BAU_900_FARIM', 'WP_START')], ROUTINES);
      overlay.setTime(at(12));

      // BAU_900_FARIM is placed at WP_MIDDLE by the routine (known) — the
      // single dummy drawn must carry the known colour, not the unknown one.
      expect(overlay.dummies.count).toBe(1);
      const color = new THREE.Color();
      overlay.dummies.getColorAt(0, color);
      const known = (overlay.markers.material as THREE.PointsMaterial).color;
      expect(color.getHex()).toBe(known.getHex());
    });

    it('carries the split on `instanceColor` alone, with `vertexColors` off', () => {
      // The one thing in this layer that fails silently and totally, and no
      // colour assertion above can see it: `getColorAt` reads the buffer back,
      // never the shader.
      //
      // three defines `USE_COLOR` in the *vertex* shader from
      // `material.vertexColors` alone, and in the *fragment* shader from
      // `vertexColors || instancingColor`. So `instanceColor` on its own
      // already reaches `diffuseColor` — while switching `vertexColors` on as
      // well would declare `attribute vec3 color` in the vertex shader and
      // multiply by it. A capsule has no such attribute, and
      // `MeshBasicMaterial` has no `defaultAttributeValues` to stand in for one
      // (that is `ShaderMaterial`'s), so the generic value stays at WebGL's
      // (0, 0, 0, 1) and every dummy draws black.
      const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);

      expect(overlay.dummies.instanceColor).not.toBeNull();
      expect((overlay.dummies.material as THREE.MeshBasicMaterial).vertexColors).toBe(false);
      // The other half of the same fact: nothing supplies the attribute that
      // `vertexColors` would have gone looking for.
      expect(overlay.dummies.geometry.getAttribute('color')).toBeUndefined();
    });

    it('moves with the time slider exactly as the dots do', () => {
      const ROUTINES = {
        sites: [
          entry('RTN_START_FARIM', at(8), at(22), 'WP_MIDDLE'),
          entry('RTN_START_FARIM', at(22), at(23), 'FP_CAMP'),
        ],
        routinesByNpc: { BAU_900_FARIM: 'RTN_START_FARIM' },
      };
      const SPAWNS = [site('BAU_900_FARIM', 'WP_START')];
      const overlay = new SpawnOverlay(waynet(), SPAWNS, ROUTINES);

      overlay.setTime(at(12));

      expect(overlay.dummies.count).toBe(1);
      const matrix = new THREE.Matrix4();
      overlay.dummies.getMatrixAt(0, matrix);
      const position = new THREE.Vector3();
      matrix.decompose(position, new THREE.Quaternion(), new THREE.Vector3());
      expect(position.x).toBe(1000); // WP_MIDDLE, not WP_START
    });

    it('follows a waypoint the payload has moved under it', () => {
      const payload = waynet();
      const overlay = new SpawnOverlay(payload, [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);

      new Float32Array(payload.positions).set([1400, 50, 900], 1 * 3);
      overlay.refresh();

      const matrix = new THREE.Matrix4();
      overlay.dummies.getMatrixAt(0, matrix);
      const position = new THREE.Vector3();
      matrix.decompose(position, new THREE.Quaternion(), new THREE.Vector3());
      expect([position.x, position.y, position.z]).toEqual([1400, 50, 900]);
    });

    it('survives a project that spawns nobody in this world', () => {
      const overlay = new SpawnOverlay(waynet(), [], NO_ROUTINES);

      expect(overlay.dummies.count).toBe(0);
      expect(() => overlay.refresh()).not.toThrow();
    });

    it('is added and released with the rest of the overlay', () => {
      const overlay = new SpawnOverlay(waynet(), [site('GRD_200_XARDAS', 'WP_MIDDLE')], NO_ROUTINES);
      expect(overlay.root.children).toContain(overlay.dummies);

      let disposed = false;
      overlay.dummies.geometry.addEventListener('dispose', () => { disposed = true; });
      overlay.dispose();

      expect(disposed).toBe(true);
      expect(overlay.root.children).toHaveLength(0);
    });
  });

  describe('who is standing on a point (§16.19 slice 14)', () => {
    // The overlay is where a waypoint name becomes a payload index, so it is
    // also where "who is on WP_MIDDLE" becomes "who is on point 1" — the only
    // question the label layer can ask, since it draws by index.
    const ROUTINES = {
      sites: [entry('RTN_START_FARIM', at(8), at(22), 'WP_MIDDLE')],
      routinesByNpc: { BAU_900_FARIM: 'RTN_START_FARIM' },
    };

    it('names the NPCs inserted at a point while no time is set', () => {
      const overlay = new SpawnOverlay(
        waynet(),
        [site('GRD_200_XARDAS', 'WP_START'), site('BAU_900_FARIM', 'WP_START')],
        NO_ROUTINES,
      );

      expect(overlay.occupantsAt(0)).toEqual(['BAU_900_FARIM', 'GRD_200_XARDAS']);
    });

    it('matches the uppercase index against the world own casing here too', () => {
      // The payload spells it `WP_Middle`; every by-name lookup on this surface
      // is uppercase, and one that forgets it answers for no point at all.
      const overlay = new SpawnOverlay(waynet(), [], ROUTINES);

      overlay.setTime(at(12));

      expect(overlay.occupantsAt(1)).toEqual(['BAU_900_FARIM']);
    });

    it('follows the slider off the point it just left', () => {
      const overlay = new SpawnOverlay(waynet(), [site('BAU_900_FARIM', 'WP_START')], ROUTINES);

      overlay.setTime(at(12));
      expect(overlay.occupantsAt(1)).toEqual(['BAU_900_FARIM']);
      expect(overlay.occupantsAt(0)).toEqual([]);

      overlay.setTime(at(3));
      // The routine is silent at 03:00, so the only stated position is the
      // spawn — the unknown layer, which is labelled too.
      expect(overlay.occupantsAt(0)).toEqual(['BAU_900_FARIM']);
      expect(overlay.occupantsAt(1)).toEqual([]);
    });

    it('answers for a point nobody stands on, rather than for undefined', () => {
      const overlay = new SpawnOverlay(waynet(), [], NO_ROUTINES);

      expect(overlay.occupantsAt(2)).toEqual([]);
      expect(overlay.occupantsAt(99)).toEqual([]);
    });
  });
});
