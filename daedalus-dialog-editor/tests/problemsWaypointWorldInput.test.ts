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
import * as scanProjectModule from '../src/renderer/problems/application/scanProject';
import { WAYNET_FLAG_FREE_POINT, type WaynetPayload } from '../src/shared/worldTypes';

/** A waynet payload with `names[i]` flagged as a free point when listed. */
const waynet = (names: string[], freePoints: string[] = []): WaynetPayload => {
  const flags = new Uint32Array(names.length);
  names.forEach((name, i) => {
    if (freePoints.includes(name)) flags[i] = WAYNET_FLAG_FREE_POINT;
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

  it('holds the uppercased names and the free-point subset, in the shape the rule reads', () => {
    useWorldStore.getState().waynetLoaded(waynet(['NW_City_01', 'FP_Roam_1'], ['FP_Roam_1']));

    expect(useWorldStore.getState().waynetNames).toEqual({
      pointNameKeys: new Set(['NW_CITY_01', 'FP_ROAM_1']),
      freePointNames: ['FP_ROAM_1'],
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
    // `{pointNameKeys: empty, freePointNames: []}` the rule's `if (!world) return []` guard does
    // not fire and every waypoint site in the project is flagged.
    useWorldStore.getState().waynetLoaded(waynet([]));

    expect(useWorldStore.getState().waynetNames).toBeNull();
  });

  it('re-derives the free points when a re-read changed only the flags', () => {
    const { waynetLoaded } = useWorldStore.getState();
    waynetLoaded(waynet(['NW_CITY_01', 'FP_ROAM_1']));
    expect(useWorldStore.getState().waynetNames?.freePointNames).toEqual([]);

    // What `removeWaypointEdge` does: it can promote an endpoint to a free
    // point, which changes the flags column and not one name. That is exactly
    // the re-read the surface issues after an edge op.
    waynetLoaded(waynet(['NW_CITY_01', 'FP_ROAM_1'], ['FP_ROAM_1']));

    expect(useWorldStore.getState().waynetNames?.freePointNames).toEqual(['FP_ROAM_1']);
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

  it('hands the scan the stored view instead of rebuilding it per scan', () => {
    // The names set is ~3,000 entries on a retail world and a scan runs on
    // every debounced keystroke re-parse, while `waynetLoaded` runs only on a
    // real change: the store builds it once and the scan passes it through.
    seedSites({ OW_PATH_42: [{ filePath: 'Rtn.d', functionName: 'Rtn_Start_Diego' }] });
    useWorldStore.getState().waynetLoaded(waynet(['NW_CITY_01']));
    const stored = useWorldStore.getState().waynetNames;
    const scanSpy = jest.spyOn(scanProjectModule, 'scanProject');

    useProblemsStore.getState().runScan();
    useProblemsStore.getState().runScan();

    expect(scanSpy).toHaveBeenCalledTimes(2);
    for (const [input] of scanSpy.mock.calls) expect(input.world).toBe(stored);
    scanSpy.mockRestore();
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
