import type { Dialog, SemanticModel } from '../src/shared/types';
import * as scanProjectModule from '../src/renderer/problems/application/scanProject';
import * as fileFactsModule from '../src/renderer/problems/domain/fileFacts';
import { useProblemsStore } from '../src/renderer/store/problemsStore';
import { useProjectStore } from '../src/renderer/store/projectStore';
import type { ParsedFileCache } from '../src/renderer/store/projectStore';
import { useWorldStore } from '../src/renderer/store/worldStore';
import { initStoreSync } from '../src/renderer/store/storeSync';
import {
  MOVE, SUMMARY, WAYPOINT_MOVE, WAYPOINT_TO, WAYPOINT_WAS, waynetPayload,
} from './worldFixtures';

const model = (overrides: Partial<SemanticModel> = {}): SemanticModel => ({
  dialogs: {},
  functions: {},
  instances: {},
  npcs: {},
  hasErrors: false,
  errors: [],
  ...overrides
});

const dialog = (name: string, npc: string): Dialog => ({
  name,
  parent: 'C_INFO',
  properties: { npc, information: `${name}_Info` }
});

const cache = (filePath: string, m: SemanticModel): ParsedFileCache => ({
  filePath,
  semanticModel: m,
  lastParsed: new Date()
});

const seedProject = (
  parsed: ParsedFileCache[],
  npcList: string[],
  allFiles: string[],
  isIngesting = false
): void => {
  useProjectStore.setState({
    parsedFiles: new Map(parsed.map((c) => [c.filePath, c])),
    npcList,
    npcPrototypes: [],
    allDialogFiles: allFiles,
    isIngesting
  });
};

describe('problemsStore scan scheduling', () => {
  let scanSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    useProblemsStore.getState().clear();
    scanSpy = jest.spyOn(scanProjectModule, 'scanProject');
  });

  afterEach(() => {
    useProblemsStore.getState().clear();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('defers scans while ingestion runs and scans exactly once when it completes', () => {
    seedProject([cache('a.d', model())], [], ['a.d', 'b.d'], true);

    // Simulate the panel effect firing on repeated parseGeneration bumps.
    for (let i = 0; i < 5; i++) {
      useProblemsStore.getState().requestScan();
    }
    jest.runAllTimers();

    expect(scanSpy).not.toHaveBeenCalled();
    expect(useProblemsStore.getState().hasScanned).toBe(false);

    // Ingestion completes; the panel effect fires once more on the flip.
    useProjectStore.setState({ isIngesting: false });
    useProblemsStore.getState().requestScan();

    // The deferred scan runs immediately, without waiting for the debounce.
    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(useProblemsStore.getState().hasScanned).toBe(true);

    jest.runAllTimers();
    expect(scanSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid requestScan calls outside ingestion into one trailing scan', () => {
    seedProject([cache('a.d', model())], [], ['a.d']);

    useProblemsStore.getState().requestScan();
    useProblemsStore.getState().requestScan();
    useProblemsStore.getState().requestScan();

    expect(scanSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(299);
    expect(scanSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(scanSpy).toHaveBeenCalledTimes(1);

    // A later request after the quiet period triggers a fresh scan.
    useProblemsStore.getState().requestScan();
    jest.advanceTimersByTime(300);
    expect(scanSpy).toHaveBeenCalledTimes(2);
  });

  it('runScan scans immediately and cancels any pending debounced scan', () => {
    seedProject([cache('a.d', model())], [], ['a.d']);

    useProblemsStore.getState().requestScan();
    useProblemsStore.getState().runScan();

    expect(scanSpy).toHaveBeenCalledTimes(1);

    jest.runAllTimers();
    expect(scanSpy).toHaveBeenCalledTimes(1);
  });
});

describe('problemsStore per-file facts cache', () => {
  beforeEach(() => {
    useProblemsStore.getState().clear();
  });

  afterEach(() => {
    useProblemsStore.getState().clear();
    jest.restoreAllMocks();
  });

  it('re-extracts facts only for files whose model identity changed since the last scan', () => {
    const modelA = model({ dialogs: { DIA_A: dialog('DIA_A', 'Diego') } });
    const modelB = model({ dialogs: { DIA_B: dialog('DIA_B', 'Nobody') } });
    seedProject([cache('a.d', modelA), cache('b.d', modelB)], ['Diego'], ['a.d', 'b.d']);

    const extractSpy = jest.spyOn(fileFactsModule, 'extractFileFacts');

    useProblemsStore.getState().runScan();
    expect(extractSpy).toHaveBeenCalledTimes(2);
    expect(
      useProblemsStore
        .getState()
        .problems.some(
          (p) => p.rule === 'npc-not-found' && p.locus.kind === 'script' && p.locus.dialogName === 'DIA_B'
        )
    ).toBe(true);

    // Unchanged model identities: no rule extraction work at all.
    extractSpy.mockClear();
    useProblemsStore.getState().runScan();
    expect(extractSpy).not.toHaveBeenCalled();

    // Only b.d gets a new model object; a.d keeps its identity.
    const modelB2 = model({ dialogs: { DIA_B: dialog('DIA_B', 'Diego') } });
    seedProject([cache('a.d', modelA), cache('b.d', modelB2)], ['Diego'], ['a.d', 'b.d']);
    useProblemsStore.getState().runScan();

    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(extractSpy).toHaveBeenCalledWith(modelB2);
    expect(useProblemsStore.getState().problems).toEqual([]);
  });

  it('applies changed cross-file inputs to cached files without re-extraction', () => {
    const modelA = model({ dialogs: { DIA_A: dialog('DIA_A', 'Diego') } });
    seedProject([cache('a.d', modelA)], [], ['a.d']);

    useProblemsStore.getState().runScan();
    expect(
      useProblemsStore
        .getState()
        .problems.some(
          (p) => p.rule === 'npc-not-found' && p.locus.kind === 'script' && p.locus.dialogName === 'DIA_A'
        )
    ).toBe(true);

    // Diego becomes a known NPC (e.g. reindex) while a.d's model is unchanged:
    // the cached facts must be re-judged against the new cross-file input.
    const extractSpy = jest.spyOn(fileFactsModule, 'extractFileFacts');
    seedProject([cache('a.d', modelA)], ['Diego'], ['a.d']);
    useProblemsStore.getState().runScan();

    expect(extractSpy).not.toHaveBeenCalled();
    expect(useProblemsStore.getState().problems).toEqual([]);
  });
});

/**
 * `routine-mob-missing` asks about *positions*, so the world edit that fixes it
 * is also the thing that has to re-run the scan (#509, world-delta finding 1).
 * The waynet half of that input is a live view over the payload's buffer,
 * because `useWorldEditPipeline` writes a committed `MoveWaypoint` into it with
 * no re-read afterwards.
 */
describe('problemsStore re-scan after a world edit', () => {
  let scanSpy: jest.SpyInstance;
  let stopSync: () => void;

  const lastScanInput = () => scanSpy.mock.calls[scanSpy.mock.calls.length - 1][0];
  const scannedWaypoint = (name: string) => lastScanInput().routinePlaces?.waypoints.get(name);

  beforeEach(() => {
    jest.useFakeTimers();
    useProblemsStore.getState().clear();
    seedProject([], [], []);
    useWorldStore.getState().reset();
    useWorldStore.getState().openSucceeded(SUMMARY);
    scanSpy = jest.spyOn(scanProjectModule, 'scanProject');
    stopSync = initStoreSync();
  });

  afterEach(() => {
    stopSync();
    useWorldStore.getState().reset();
    useProblemsStore.getState().clear();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('schedules a scan after a VOB move', () => {
    useProblemsStore.getState().runScan();
    expect(scanSpy).toHaveBeenCalledTimes(1);

    useWorldStore.getState().applyEdit([MOVE]);
    jest.runOnlyPendingTimers();

    expect(scanSpy).toHaveBeenCalledTimes(2);
  });

  it('schedules a scan after a waypoint move', () => {
    useWorldStore.getState().waynetLoaded(waynetPayload());
    useProblemsStore.getState().runScan();
    jest.runOnlyPendingTimers();

    useWorldStore.getState().applyEdit([WAYPOINT_MOVE]);
    jest.runOnlyPendingTimers();

    expect(scanSpy).toHaveBeenCalledTimes(2);
  });

  it('costs one scan for a whole drag, not one per frame', () => {
    // A commit is one per gesture, and `requestScan` debounces whatever arrives
    // inside the window: the counter is a trigger, not a scan per bump.
    useProblemsStore.getState().runScan();

    for (let frame = 0; frame < 5; frame += 1) useWorldStore.getState().applyEdit([MOVE]);
    jest.advanceTimersByTime(300);

    expect(scanSpy).toHaveBeenCalledTimes(2);
  });

  it('reads a moved waypoint where it was dragged to, not where the last waynet read left it', () => {
    const payload = waynetPayload();
    useWorldStore.getState().waynetLoaded(payload);
    useProblemsStore.getState().runScan();
    expect(scannedWaypoint('WP_MIDDLE')).toEqual(WAYPOINT_WAS);

    // What the viewport does with a committed move: write it into the payload's
    // own buffer, with no re-read of the waynet.
    new Float32Array(payload.positions).set(WAYPOINT_TO, 3);
    useWorldStore.getState().applyEdit([WAYPOINT_MOVE]);
    useProblemsStore.getState().runScan();

    expect(scannedWaypoint('WP_MIDDLE')).toEqual(WAYPOINT_TO);
  });
});
