// The contract between the renderer, WorldService and the zenkit worker
// (level-editor.md §7). The payload shapes themselves live in `zen-world`,
// which is where they are tested; this file adds only what crossing a process
// boundary needs — the request/response envelope and the summary.

import type {
  AssetCatalog, DecalGroup, DecalScene, DrawGroup, InstancedVisual, PortalFinding, VisualScene,
  VobFolders, VobIndex, WaynetPayload, WorldOp,
} from 'zen-world';

export type {
  AssetCatalog, DecalGroup, DecalScene, DrawGroup, InstancedVisual, PortalFinding, VisualScene,
  VobFolders, VobIndex, WaynetPayload, WorldOp,
};

// Values, not types, so they are re-exported as values: the overlay and the
// Problems scan read them at runtime.
export { WAYNET_FLAG_FREE_POINT, WAYNET_FLAG_UNDER_WATER } from 'zen-world';

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
  /** What the VFS was mounted from, in mount order — later wins. Main resolves
   *  the list and the renderer never builds it, so this is how the asset
   *  browser learns the names behind {@link VfsEntry.sources}. */
  assetSources: string[];
}

export interface WorldMeshPayload {
  groups: DrawGroup[];
  bbox: number[];
}

export interface InstancedPayload {
  visuals: InstancedVisual[];
  /**
   * The decals, as quads (#249). Beside the instanced visuals rather than behind
   * an op of their own, because they are built from the same index and rebuilt
   * by the same structural op: a decal placed or deleted has to arrive with the
   * scene the placement rebuilt, not one round trip later.
   */
  decals: DecalScene;
  stats: {
    visualsSeen: number;
    visualsResolved: number;
    vobsPlaced: number;
    instancedDrawGroups: number;
    levelCompos: number;
    unresolvedByType: Record<string, number>;
  };
}

/** One entry of a VFS directory listing — see zenkit-node's `vfsList`. */
export interface VfsEntry {
  name: string;
  type: 'file' | 'directory';
  /**
   * The mounts holding this entry, as indices into {@link WorldSummary.assetSources},
   * ascending: the last is the one the merged namespace serves and the earlier
   * ones are what it shadows. Optional because the catalogue views (favorites,
   * categories) name assets that were never listed out of a directory, and an
   * invented provenance there would be a lie.
   */
  sources?: number[];
  /**
   * The directory holding it, `'/'` at the root. Set on a search hit
   * (zenkit-node's `vfsFind`), which is the whole point of one: it was found
   * somewhere the browser is not standing. Absent on a listing's entry, which
   * is by construction in the directory that was listed.
   */
  directory?: string;
}

export interface DecodedTexture {
  name: string;
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

/** What a whole-namespace search answers. `truncated` is the cap being hit,
 *  not a failure — a short needle matches thousands of entries on a retail
 *  install and the browser says so rather than pretending it saw them all. */
export interface VfsSearch {
  matches: VfsEntry[];
  truncated: boolean;
}

export type WorldWorkerOp =
  | 'open' | 'worldMesh' | 'visuals' | 'texture' | 'assets' | 'assetSearch' | 'waynet' | 'portalFindings'
  | 'visualBounds' | 'visual' | 'vobProps' | 'refreshIndex' | 'applyOps' | 'save' | 'close';

/**
 * The portal checks' findings (level-editor.md §16.20 slice 3, §16.22 q1–q3),
 * computed in the worker over `getPortals` and crossing as data.
 *
 * Each finding carries the corners of the one polygon it names, which is what
 * lets the Problems panel frame it (#222, 2026-09-12). This is not the 5 MB of
 * mesh corners the first cut refused: findings are the polygons that are
 * *wrong*, and retail's four worlds produce one between them. See
 * `PortalLocus` in `zen-world`'s `validate/portals.ts` for why the geometry
 * cannot be recovered on this side instead.
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

/** Internal worker payload. Main derives this target from the open world; the
 *  renderer never supplies it. */
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
