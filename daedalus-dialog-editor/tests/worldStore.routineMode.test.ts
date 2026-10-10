/**
 * What routine mode needs from the world store (npc-editor.md §6).
 *
 * A routine stop is only offered on a waypoint the world file on disk has
 * (Daniel, 2026-09-28): a stop on one added this session would be a script
 * pointing at nothing until the world is saved. So the store keeps the
 * waynet's names as of the last open or save, apart from the live waynet.
 *
 * @jest-environment jsdom
 */

import { useWorldStore } from '../src/renderer/store/worldStore';
import type { WaynetPayload, WorldSummary } from '../src/shared/worldTypes';

const summary: WorldSummary = {
  worldPath: 'C:/Gothic/NewWorld.zen',
  bbox: [0, 0, 0, 1, 1, 1],
  vobIndex: {
    count: 0,
    parent: new Int32Array(0).buffer, childIndex: new Uint32Array(0).buffer,
    positions: new Float32Array(0).buffer, rotations: new Float32Array(0).buffer, flags: new Uint32Array(0).buffer,
    classes: [], classIndex: new Uint32Array(0).buffer, names: [], nameIndex: new Uint32Array(0).buffer,
    visuals: [], visualIndex: new Uint32Array(0).buffer, visualTypes: [], visualTypeIndex: new Uint32Array(0).buffer,
    decalVobs: new ArrayBuffer(0), decalDimensions: new ArrayBuffer(0), decalAlphaWeights: new ArrayBuffer(0),
  },
  stats: { vobCount: 0, materials: 0, worldDrawGroups: 0, worldTriangles: 0 },
  timings: {},
  assetSources: [],
};

const waynet = (names: string[]): WaynetPayload => ({
  count: names.length,
  names,
  positions: new Float32Array(names.length * 3).buffer,
  directions: new Float32Array(names.length * 3).buffer,
  waterDepths: new Int32Array(names.length).buffer,
  flags: new Uint32Array(names.length).buffer,
  edgeCount: 0,
  edges: new Uint32Array(0).buffer,
  danglingEdges: 0,
});

describe('worldStore — saved waypoints', () => {
  beforeEach(() => {
    useWorldStore.getState().reset();
    useWorldStore.getState().openSucceeded(summary);
  });

  it('knows nothing until the first waynet of an open arrives, which is the file on disk', () => {
    expect(useWorldStore.getState().savedWaypoints).toBeNull();
    useWorldStore.getState().waynetLoaded(waynet(['WP_A', 'WP_B']));
    expect(useWorldStore.getState().savedWaypoints).toEqual(['WP_A', 'WP_B']);
  });

  it('does not count a waypoint added since as saved, until the world is saved', () => {
    useWorldStore.getState().waynetLoaded(waynet(['WP_A']));
    useWorldStore.getState().waynetLoaded(waynet(['WP_A', 'WP_NEW']));
    expect(useWorldStore.getState().savedWaypoints).toEqual(['WP_A']);

    useWorldStore.getState().waynetSaved(['WP_A', 'WP_NEW']);
    expect(useWorldStore.getState().savedWaypoints).toEqual(['WP_A', 'WP_NEW']);
  });

  it('forgets them when another world is opened', () => {
    useWorldStore.getState().waynetLoaded(waynet(['WP_A']));
    useWorldStore.getState().beginOpen();
    expect(useWorldStore.getState().savedWaypoints).toBeNull();
  });
});

describe('worldStore — routine requests', () => {
  beforeEach(() => useWorldStore.getState().reset());

  it('holds a request from the NPC editor until the surface takes it', () => {
    useWorldStore.getState().requestRoutine({ npc: 'BAU_900_Onar', routine: 'RTN_START_900' });
    expect(useWorldStore.getState().routineRequest).toEqual({ npc: 'BAU_900_Onar', routine: 'RTN_START_900' });
    useWorldStore.getState().routineRequestHandled();
    expect(useWorldStore.getState().routineRequest).toBeNull();
  });
});
