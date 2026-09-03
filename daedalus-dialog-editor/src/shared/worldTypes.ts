// The contract between the renderer, WorldService and the zenkit worker
// (level-editor.md §7). The payload shapes themselves live in `zen-world`,
// which is where they are tested; this file adds only what crossing a process
// boundary needs — the request/response envelope and the summary.

import type {
  AssetCatalog, DrawGroup, InstancedVisual, PortalFinding, VisualScene, VobFolders, VobIndex, WorldOp,
} from 'zen-world';

export type { AssetCatalog, DrawGroup, InstancedVisual, PortalFinding, VisualScene, VobFolders, VobIndex, WorldOp };

export type GameVersion = 'g1' | 'g2';

export interface OpenWorldRequest {
  worldPath: string;
  gameVersion: GameVersion;
  /**
   * VDF/MOD archives and loose directories, in ZenGin load order — later wins.
   * Prefer archives: mounting an extracted install's loose `_compiled` trees
   * costs 2,170 ms against 15 ms for the equivalent VDFs (zenkit-node README).
   */
  /** Identity of the main-process-owned project configuration supplying mounts. */
  projectFilePath: string;
}

/** Main-process/worker contract after project mounts have been resolved. */
export interface ResolvedOpenWorldRequest {
  worldPath: string;
  gameVersion: GameVersion;
  assetSources: string[];
}

/** A `.zen` found under the project's asset sources (level-editor.md §16.31). */
export interface DiscoveredWorld {
  path: string;
  /** The file name as it is cased on disk — what GMBT's `--world` compares. */
  name: string;
  /** The asset source it was found under. */
  source: string;
  /** The GMBT project's `defaultWorld`. */
  isDefault: boolean;
}

export interface WorldSummary {
  worldPath: string;
  /** ZenGin space, computed from the vertices the binding emitted — a retail
   *  zCMesh stores its own bbox as all zeros. */
  bbox: number[];
  vobIndex: VobIndex;
  stats: {
    vobCount: number;
    materials: number;
    worldDrawGroups: number;
    worldTriangles: number;
  };
  /** Per phase, not per block: one stopwatch around the load is how the spike
   *  blamed the BVH for a cost that was `openVfs`. */
  timings: Record<string, number>;
}

export interface WorldMeshPayload {
  groups: DrawGroup[];
  bbox: number[];
}

export interface InstancedPayload {
  visuals: InstancedVisual[];
  stats: {
    visualsSeen: number;
    visualsResolved: number;
    vobsPlaced: number;
    instancedDrawGroups: number;
    levelCompos: number;
    unresolvedByType: Record<string, number>;
  };
}

/**
 * The bits packed into {@link WaynetPayload.flags}, defined once beside the
 * field they describe. The overlay colours a point from them and the Problems
 * scan derives the free-point set from them; a private copy in either that
 * drifts from `getWaynet` is a silent misclassification, not a failure.
 */
export const WAYNET_FLAG_FREE_POINT = 0b01;
export const WAYNET_FLAG_UNDER_WATER = 0b10;

/**
 * The waynet as a drawable graph (zenkit-node's `getWaynet`). Stored order,
 * ZenGin space, edges as index pairs — an overlay builds a line buffer from
 * indices, and the single coordinate conversion stays at the scene root.
 */
export interface WaynetPayload {
  count: number;
  names: string[];
  positions: ArrayBuffer;
  directions: ArrayBuffer;
  waterDepths: ArrayBuffer;
  /** {@link WAYNET_FLAG_FREE_POINT} and {@link WAYNET_FLAG_UNDER_WATER}. */
  flags: ArrayBuffer;
  edgeCount: number;
  edges: ArrayBuffer;
  danglingEdges: number;
}

/** One entry of a VFS directory listing — see zenkit-node's `vfsList`. */
export interface VfsEntry {
  name: string;
  type: 'file' | 'directory';
}

export interface DecodedTexture {
  name: string;
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

export type WorldWorkerOp =
  | 'open' | 'worldMesh' | 'visuals' | 'texture' | 'assets' | 'waynet' | 'portalFindings'
  | 'visualBounds' | 'visual' | 'vobProps' | 'refreshIndex' | 'applyOps' | 'save' | 'close';

/**
 * The portal checks' findings (level-editor.md §16.20 slice 3, §16.22 q1–q3),
 * computed in the worker over `getPortals` and crossing as data. The renderer
 * gets findings and not geometry: nothing frames a polygon (decided
 * 2026-09-02), so nothing on this side has a use for 5 MB of corners.
 */
export type PortalFindingsPayload = readonly PortalFinding[];

/**
 * The bounds of a visual that is **not** in the scene — what a visual swap needs
 * and nothing else does.
 *
 * Every other op refits a box from bounds the renderer already has: they came
 * across with the geometry, six numbers beside buffers that were crossing
 * anyway. A visual the world does not currently use has no instance and no
 * payload, so its bounds are the one thing here that has to be asked for.
 */
export interface VisualBoundsRequest {
  name: string;
}

/**
 * One visual by name, unplaced, for the Assets panel's mesh preview
 * (level-editor.md §16.26 row 1). The answer is a `VisualScene`: the draw
 * groups `buildScene` would place for it, merged the same way, and null for a
 * name the binding cannot extract.
 */
export interface VisualRequest {
  name: string;
}

/**
 * The per-class fields of one VOB, addressed by its native index path.
 *
 * A read, and one that has to be asked for every time: the columnar index
 * interns a VOB's class *name* and carries no per-class data at all, so there is
 * nothing in the summary to project this from. The path rather than the flat
 * index, because that is the address every op resolves through and the one the
 * binding walks.
 */
export interface VobPropsRequest {
  path: string;
}

/** The payload of an `applyOps` request. Undo and redo are the same request
 *  with inverted ops (level-editor.md §7). */
export interface ApplyOpsRequest {
  ops: WorldOp[];
}

/** Where to write the world. Always an explicit target: the app never writes
 *  back over the file it opened unless the user names it in the save dialog. */
export interface SaveWorldRequest {
  targetPath: string;
}

export interface WorldWorkerRequest {
  id: string;
  op: WorldWorkerOp;
  payload?: unknown;
}

export type WorldWorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };
