import type { VobIndex } from 'zen-world';
import type { VobFolders, WaynetPayload, WorldOp, WorldSummary } from '../src/shared/worldTypes';

/**
 * Shared pure-data builders for the World surface's test suites
 * (`docs/architecture/level-editor.md` §17). Moved out of
 * `WorldSurface.editing.test.tsx` so new test files (shortcuts, toolbar,
 * context menu, panels, ...) don't each reinvent a `VobIndex`.
 *
 * The `jest.mock('.../WorldViewport')` factory cannot move here — jest hoists
 * `jest.mock` calls above imports, and a factory referencing an imported
 * module-level mock breaks that hoist. Each test file that needs the viewport
 * stub declares its own.
 */

/** Waypoint 1's position in `waynetPayload()`, and where the drag stub moves
 *  it to — shared so a shortcuts-style test can compute the same op. */
export const WAYPOINT_WAS: [number, number, number] = [1000, 0, 1000];
export const WAYPOINT_TO: [number, number, number] = [1400, 50, 900];

/**
 * A three-waypoint waynet, in the shape `getWaynet` emits it.
 *
 * Fresh per test, because the overlay draws a *view* over `positions` and an
 * applied move writes it in place — a shared fixture would carry one test's
 * move into the next.
 */
export function waynetPayload(): WaynetPayload {
  return {
    count: 3,
    names: ['WP_START', 'WP_MIDDLE', 'WP_END'],
    positions: new Float32Array([0, 0, 0, ...WAYPOINT_WAS, 2000, 0, 2000]).buffer,
    directions: new Float32Array(9).buffer,
    waterDepths: new Int32Array(3).buffer,
    flags: new Uint32Array(3).buffer,
    edgeCount: 2,
    edges: new Uint32Array([0, 1, 1, 2]).buffer,
    danglingEdges: 0,
  };
}

export function vobIndex(
  positions: Array<[number, number, number]>,
  cls: string | readonly string[] = 'zCVob',
  // One parent per VOB, all roots unless a test wants a hierarchy — which the
  // paste does, because "into the selection's parent" is only distinguishable
  // from "into the roots" when the selection has one.
  parents: readonly number[] = positions.map(() => -1),
  // One name per VOB. Every VOB is `BARREL` unless a test names them, which
  // the free-point jump does: a free point is found by *its own name*.
  vobNames: readonly string[] = positions.map(() => 'BARREL'),
): VobIndex {
  const count = positions.length;
  const columns = new Float32Array(count * 3);
  positions.forEach((position, i) => columns.set(position, i * 3));
  const seen = new Map<number, number>();
  const childIndex = new Uint32Array(count);
  parents.forEach((parent, i) => {
    const slot = seen.get(parent) ?? 0;
    childIndex[i] = slot;
    seen.set(parent, slot + 1);
  });
  // Identity, not zeros: a zero matrix is not a rotation any world contains,
  // and a rotation op composed onto one produces a box collapsed to a point.
  const rotations = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) rotations.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);

  // One class name for the whole index, or one per VOB when a list is given.
  // The list is not a convenience: a single class means the selection can never
  // move between two *catalogued* classes, and that is exactly the move where
  // the class fields drawn and the props fetched can disagree.
  const perVob = typeof cls === 'string' ? positions.map(() => cls) : cls;
  const classes = [...new Set(perVob)];
  const classIndex = new Uint32Array(count);
  perVob.forEach((name, i) => { classIndex[i] = classes.indexOf(name); });

  return {
    count,
    parent: Int32Array.from(parents).buffer,
    childIndex: childIndex.buffer,
    positions: columns.buffer,
    rotations: rotations.buffer,
    flags: new Uint32Array(count).buffer,
    classes, classIndex: classIndex.buffer,
    names: [...new Set(vobNames)],
    nameIndex: Uint32Array.from(vobNames.map((n) => [...new Set(vobNames)].indexOf(n))).buffer,
    visuals: ['BARREL.3DS'], visualIndex: new Uint32Array(count).buffer,
    visualTypes: ['MULTI_RESOLUTION_MESH'], visualTypeIndex: new Uint32Array(count).buffer,
  };
}

export const SUMMARY: WorldSummary = {
  worldPath: 'C:/Gothic/NewWorld.zen',
  bbox: [0, 0, 0, 1, 1, 1],
  vobIndex: vobIndex([[0, 0, 0], [10, 20, 30]]),
  stats: { vobCount: 2, materials: 1, worldDrawGroups: 1, worldTriangles: 1 },
  timings: {},
};

/** The three `zCVob` fields every read carries, whatever the class — they are
 *  base fields and no VOB is without them. */
export const BASE_PROPS = { presetName: 'FIRE_STAT', visualCamAlign: 1, bias: 2 };

/** The op a single-VOB drag becomes in the fixture above — VOB 1 at
 *  `[10, 20, 30]`, dragged by the stub's fixed delta. */
export const MOVE: WorldOp = {
  op: 'MoveVob', vob: 1, path: '1', from: [10, 20, 30], to: [11, 22, 33],
};

/** The op a drag of waypoint 1 has to become. */
export const WAYPOINT_MOVE: WorldOp = {
  op: 'MoveWaypoint', waypoint: 1, name: 'WP_MIDDLE', from: WAYPOINT_WAS, to: WAYPOINT_TO,
};

/**
 * A fresh `editorAPI` mock, one `jest.fn()` per IPC method. A factory rather
 * than a shared object: each test file's `beforeEach` calls
 * `jest.clearAllMocks()` against its own module-level mocks, and a shared
 * object would let one file's implementation (`mockResolvedValueOnce`, ...)
 * bleed into another's.
 */
export function makeWorldEditorApi() {
  return {
    getGothicInstall: jest.fn(async () => 'C:/Gothic II'),
    selectGothicInstall: jest.fn(),
    openWorldDialog: jest.fn(),
    openWorld: jest.fn(),
    getWorldMesh: jest.fn(),
    getWorldVisuals: jest.fn(),
    getWorldTexture: jest.fn(async () => null),
    listWorldAssets: jest.fn(async () => null),
    getWorldWaynet: jest.fn(),
    getVisualBounds: jest.fn(async (): Promise<number[] | null> => null),
    getVobProps: jest.fn(async (): Promise<Record<string, unknown>> => ({ class: 'zCVob', ...BASE_PROPS })),
    refreshWorldIndex: jest.fn(),
    applyWorldOps: jest.fn(async () => undefined),
    undoWorldEdit: jest.fn(async (): Promise<WorldOp[] | null> => null),
    redoWorldEdit: jest.fn(async (): Promise<WorldOp[] | null> => null),
    getWorldHistoryDepth: jest.fn(async (): Promise<{ undo: number; redo: number }> => ({ undo: 0, redo: 0 })),
    saveWorldDialog: jest.fn(async (): Promise<string | null> => null),
    saveWorld: jest.fn(async () => undefined),
    getVobFolders: jest.fn(async (): Promise<VobFolders> => ({ folders: [] })),
    saveVobFolders: jest.fn(async () => undefined),
    closeWorld: jest.fn(),
  };
}
