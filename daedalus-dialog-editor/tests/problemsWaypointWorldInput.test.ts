/**
 * The world input the dangling-waypoint rule needs, and the re-scan that keeps
 * it current (level-editor.md §16.8).
 *
 * Three parts and all three or none: the waynet's names reach `worldStore`, the
 * Problems scan reads them the way it reads `knownNpcNames` from `projectStore`,
 * and the scan re-runs when the *name set* changes — world open/close and the
 * three waypoint ops that add, delete or rename one, and nothing else.
 *
 * @jest-environment jsdom
 */

import { useWorldStore } from '../src/renderer/store/worldStore';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import { initStoreSync } from '../src/renderer/store/storeSync';
import type { WaynetPayload } from '../src/shared/worldTypes';

const FREE_POINT = 1;

/** A waynet payload with `names[i]` flagged as a free point when listed. */
const waynet = (names: string[], freePoints: string[] = []): WaynetPayload => {
  const flags = new Uint32Array(names.length);
  names.forEach((name, i) => {
    if (freePoints.includes(name)) flags[i] = FREE_POINT;
  });
  return {
    count: names.length,
    names,
    positions: new Float32Array(names.length * 3).buffer,
    directions: new Float32Array(names.length * 3).buffer,
    waterDepths: new Float32Array(names.length).buffer,
    flags: flags.buffer,
    edgeCount: 0,
    edges: new Uint32Array(0).buffer,
    danglingEdges: 0,
  };
};

const seedSites = (sites: Record<string, Array<{ filePath: string; functionName: string }>>): void => {
  useProjectStore.setState({
    parsedFiles: new Map(),
    npcList: [],
    npcPrototypes: [],
    allDialogFiles: [],
    waypointSiteIndex: sites,
  });
};

describe('worldStore.waynetLoaded', () => {
  beforeEach(() => useWorldStore.getState().reset());

  it('holds the uppercased names and the free-point subset', () => {
    useWorldStore.getState().waynetLoaded(waynet(['NW_City_01', 'FP_Roam_1'], ['FP_Roam_1']));

    expect(useWorldStore.getState().waynetNames).toEqual({
      all: ['NW_CITY_01', 'FP_ROAM_1'],
      freePoints: ['FP_ROAM_1'],
    });
  });

  it('keeps the same object when a re-read changed no name', () => {
    const { waynetLoaded } = useWorldStore.getState();
    waynetLoaded(waynet(['NW_CITY_01']));
    const first = useWorldStore.getState().waynetNames;

    // A `SetWaypointEdge` re-reads the whole payload, and the names it returns
    // are the same ones: the re-scan must not fire for it.
    waynetLoaded(waynet(['NW_CITY_01']));
    expect(useWorldStore.getState().waynetNames).toBe(first);

    waynetLoaded(waynet(['NW_CITY_01', 'NW_CITY_02']));
    expect(useWorldStore.getState().waynetNames).not.toBe(first);
  });

  it('reads an empty waynet as nothing known, not as an empty world', () => {
    // `normalize.cc` answers a world with no waynet chunk with an empty point
    // list rather than throwing, so this is reachable. Stored as
    // `{all: [], freePoints: []}` the rule's `if (!world) return []` guard does
    // not fire and every waypoint site in the project is flagged.
    useWorldStore.getState().waynetLoaded(waynet([]));

    expect(useWorldStore.getState().waynetNames).toBeNull();
  });

  it('re-derives the free points when a re-read changed only the flags', () => {
    const { waynetLoaded } = useWorldStore.getState();
    waynetLoaded(waynet(['NW_CITY_01', 'FP_ROAM_1']));
    expect(useWorldStore.getState().waynetNames?.freePoints).toEqual([]);

    // What `removeWaypointEdge` does: it can promote an endpoint to a free
    // point, which changes the flags column and not one name. That is exactly
    // the re-read the surface issues after an edge op.
    waynetLoaded(waynet(['NW_CITY_01', 'FP_ROAM_1'], ['FP_ROAM_1']));

    expect(useWorldStore.getState().waynetNames?.freePoints).toEqual(['FP_ROAM_1']);
  });

  it('is cleared when a world opens or the surface resets', () => {
    useWorldStore.getState().waynetLoaded(waynet(['NW_CITY_01']));
    useWorldStore.getState().beginOpen();
    expect(useWorldStore.getState().waynetNames).toBeNull();

    useWorldStore.getState().waynetLoaded(waynet(['NW_CITY_01']));
    useWorldStore.getState().reset();
    expect(useWorldStore.getState().waynetNames).toBeNull();
  });
});

describe('the Problems scan over an open world', () => {
  beforeEach(() => {
    useWorldStore.getState().reset();
    useProblemsStore.getState().clear();
  });

  it('flags a script site the open world has no waypoint for', () => {
    seedSites({ OW_PATH_42: [{ filePath: 'Rtn.d', functionName: 'Rtn_Start_Diego' }] });
    useWorldStore.getState().waynetLoaded(waynet(['NW_CITY_01']));

    useProblemsStore.getState().runScan();

    const found = useProblemsStore.getState().problems.filter((p) => p.rule === 'waypoint-not-in-world');
    expect(found).toHaveLength(1);
    expect(found[0].filePath).toBe('Rtn.d');
  });

  it('says nothing about the same site when no world is open', () => {
    seedSites({ OW_PATH_42: [{ filePath: 'Rtn.d', functionName: 'Rtn_Start_Diego' }] });

    useProblemsStore.getState().runScan();

    expect(useProblemsStore.getState().problems.some((p) => p.rule === 'waypoint-not-in-world')).toBe(false);
  });
});

describe('the re-scan trigger', () => {
  let stopSync: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    useWorldStore.getState().reset();
    useProblemsStore.getState().clear();
    seedSites({ OW_PATH_42: [{ filePath: 'Rtn.d', functionName: 'Rtn_Start_Diego' }] });
    stopSync = initStoreSync();
  });

  afterEach(() => {
    stopSync();
    jest.useRealTimers();
  });

  it('re-scans when the waynet name set changes', () => {
    useWorldStore.getState().waynetLoaded(waynet(['NW_CITY_01']));
    jest.runOnlyPendingTimers();

    expect(useProblemsStore.getState().hasScanned).toBe(true);
    expect(useProblemsStore.getState().problems.some((p) => p.rule === 'waypoint-not-in-world')).toBe(true);
  });

  it('does not re-scan when a re-read left every name alone', () => {
    useWorldStore.getState().waynetLoaded(waynet(['NW_CITY_01']));
    jest.runOnlyPendingTimers();
    useProblemsStore.getState().clear();

    useWorldStore.getState().waynetLoaded(waynet(['NW_CITY_01']));
    jest.runOnlyPendingTimers();

    expect(useProblemsStore.getState().hasScanned).toBe(false);
  });
});
