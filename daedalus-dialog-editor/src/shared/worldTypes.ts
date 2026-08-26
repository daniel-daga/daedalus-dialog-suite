// The contract between the renderer, WorldService and the zenkit worker
// (level-editor.md §7). The payload shapes themselves live in `zen-world`,
// which is where they are tested; this file adds only what crossing a process
// boundary needs — the request/response envelope and the summary.

import type { DrawGroup, InstancedVisual, VobIndex, WorldOp } from 'zen-world';

export type { DrawGroup, InstancedVisual, VobIndex, WorldOp };

export type GameVersion = 'g1' | 'g2';

export interface OpenWorldRequest {
  worldPath: string;
  gameVersion: GameVersion;
  /**
   * VDF/MOD archives and loose directories, in ZenGin load order — later wins.
   * Prefer archives: mounting an extracted install's loose `_compiled` trees
   * costs 2,170 ms against 15 ms for the equivalent VDFs (zenkit-node README).
   */
  assetSources: string[];
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
  /** bit 0 freePoint, bit 1 underWater. */
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
  | 'open' | 'worldMesh' | 'visuals' | 'texture' | 'assets' | 'waynet' | 'applyOps' | 'close';

/** The payload of an `applyOps` request. Undo and redo are the same request
 *  with inverted ops (level-editor.md §7). */
export interface ApplyOpsRequest {
  ops: WorldOp[];
}

export interface WorldWorkerRequest {
  id: string;
  op: WorldWorkerOp;
  payload?: unknown;
}

export type WorldWorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };
