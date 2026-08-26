import { parentPort } from 'worker_threads';
import * as zenkit from 'zenkit-node';
import {
  applyOps,
  buildInstancedVisuals,
  buildWorldMesh,
  commitOps,
  createVobReader,
  groupTransferables,
  isStructuralOp,
  visualBounds,
  type MeshChunk,
  type SceneBinding,
  type ZenBounds,
} from 'zen-world';
import type {
  ApplyOpsRequest,
  VisualBoundsRequest,
  SaveWorldRequest,
  DecodedTexture,
  InstancedPayload,
  OpenWorldRequest,
  WorldMeshPayload,
  WorldSummary,
  VfsEntry,
  WaynetPayload,
  WorldWorkerRequest,
} from '../../shared/worldTypes';

// The thread that holds the world (level-editor.md §7). Thin on purpose: every
// decision worth testing lives in `zen-world`, and this file is the adapter
// between the native binding and that domain plus the request loop.
//
// A load is timed *per phase*, never as one block. The spike's first report
// blamed the BVH for 2.7 s; timing each phase separately showed the two real
// costs were `normalizeWorld` (933 ms, replaced by `vobIndex`) and `openVfs`
// (2102 ms, fixed by mounting archives instead of loose trees), neither of
// which anyone had suspected.

let handle: zenkit.WorldHandle | null = null;
let vfs: zenkit.VfsHandle | null = null;
let index: zenkit.VobIndex | null = null;
// Extracted during `open` so its 267 ms sits inside the measured cold open
// rather than surfacing later as an unexplained stall.
let worldMesh: ReturnType<typeof buildWorldMesh> | null = null;
// What an open established and a structural edit does not change — kept so the
// index can be re-read without re-loading the world and losing every edit.
let openedPath: string | null = null;
let worldBbox: number[] | null = null;
let openedStats: WorldSummary['stats'] | null = null;

// `zenkit-node` omits `lights` on a proto-mesh chunk; `zen-world` wants the
// absence stated. This is the whole of the impedance mismatch between them.
function withLights(chunk: zenkit.MeshChunk): MeshChunk {
  return { ...chunk, lights: chunk.lights ?? null };
}

const binding: SceneBinding = {
  extractWorldMesh: (world) => {
    const mesh = zenkit.extractWorldMesh(world as zenkit.WorldHandle);
    return { ...mesh, chunks: mesh.chunks.map(withLights) };
  },
  extractVisual: (vfsHandle, name) => {
    const visual = zenkit.extractVisual(vfsHandle as zenkit.VfsHandle, name);
    return visual === null ? null : { source: visual.source, chunks: visual.chunks.map(withLights) };
  },
};

const timings: Record<string, number> = {};
function phase<T>(name: string, run: () => T): T {
  const started = Date.now();
  const value = run();
  timings[name] = Date.now() - started;
  return value;
}

function open(request: OpenWorldRequest): { result: WorldSummary; transfer: ArrayBuffer[] } {
  for (const key of Object.keys(timings)) delete timings[key];

  handle = phase('loadWorld', () => zenkit.loadWorld(request.worldPath, request.gameVersion));
  // vobIndex, not normalizeWorld: the dump costs 877 ms on NewWorld's 23,288
  // VOBs and the render path wants none of what it adds.
  index = phase('vobIndex', () => zenkit.vobIndex(handle!));
  vfs = phase('openVfs', () => zenkit.openVfs(request.assetSources, { overwrite: 'all' }));
  const mesh = phase('extractWorldMesh', () => buildWorldMesh(binding, handle!));

  worldMesh = mesh;
  openedPath = request.worldPath;
  worldBbox = mesh.bbox;
  openedStats = {
    vobCount: index.count,
    materials: mesh.stats.materials,
    worldDrawGroups: mesh.stats.drawGroups,
    worldTriangles: mesh.stats.triangles,
  };

  return {
    result: {
      worldPath: request.worldPath,
      bbox: mesh.bbox,
      vobIndex: index,
      stats: { ...openedStats },
      timings: { ...timings },
    },
    // Nothing is transferred here, and that is deliberate. Transferring the
    // index's columns detaches them on this side, and `visuals` reads exactly
    // those columns to decide what to place — measured against retail NewWorld,
    // doing so fails with "Construct on a detached ArrayBuffer". The index is
    // also the authoritative VOB enumeration this worker keeps for later ops.
    // Copying it is 1.69 MB; transfer is for the geometry, which is 31 MB and
    // which this side genuinely does hand over.
    transfer: [],
  };
}

/**
 * The VOB enumeration again, after a structural edit has changed it.
 *
 * A VOB's flat index is its position in a depth-first traversal, so adding one
 * changes how many there are and the renderer's columnar projection cannot be
 * patched — `zen-world`'s `applyOps` refuses a structural op by name rather than
 * pretending. This re-reads the index from the world **this thread already
 * holds**: re-opening would re-load from disk and throw away every edit.
 *
 * The world mesh is not re-extracted. Nothing structural about the VOB tree
 * touches it, and it is the expensive half of an open.
 */
function refreshIndex(): { result: WorldSummary; transfer: ArrayBuffer[] } {
  index = phase('vobIndex', () => zenkit.vobIndex(handle!));
  return {
    result: {
      worldPath: openedPath!,
      bbox: worldBbox!,
      vobIndex: index,
      stats: { ...openedStats!, vobCount: index.count },
      timings: { ...timings },
    },
    transfer: [],
  };
}

function takeWorldMesh(): { result: WorldMeshPayload; transfer: ArrayBuffer[] } {
  // Re-extracted if it has already been handed over: the buffers were
  // transferred, so this side no longer has them. That re-extract is the
  // measured reload-after-an-edit path — 267 ms on retail NewWorld, against a
  // 2 s budget — so asking twice is slow, not broken.
  const mesh = worldMesh ?? phase('extractWorldMesh', () => buildWorldMesh(binding, handle!));
  worldMesh = null;
  return {
    result: { groups: mesh.groups, bbox: mesh.bbox },
    transfer: groupTransferables(mesh.groups),
  };
}

function visuals(): { result: InstancedPayload; transfer: ArrayBuffer[] } {
  const built = phase('visuals', () => buildInstancedVisuals(binding, vfs!, index!));
  const transfer: ArrayBuffer[] = [];
  for (const visual of built.visuals) {
    transfer.push(visual.matrices, visual.vobIds, ...groupTransferables(visual.groups));
  }
  return { result: built, transfer };
}

function texture(payload: { name: string; maxSize: number }): {
  result: DecodedTexture | null;
  transfer: ArrayBuffer[];
} {
  let decoded = zenkit.decodeTexture(vfs!, payload.name, 0);
  if (decoded === null) return { result: null, transfer: [] };

  // Pick a mipmap rather than resampling. Decoding every texture at full size
  // is 490 MB of RGBA for NewWorld; the level the caller asks for is a
  // projection-layer choice, so it comes in with the request.
  let level = 0;
  while (Math.max(decoded.width, decoded.height) > payload.maxSize && level + 1 < decoded.mipmaps) {
    decoded = zenkit.decodeTexture(vfs!, payload.name, ++level)!;
  }

  return {
    result: { name: payload.name, width: decoded.width, height: decoded.height, rgba: decoded.rgba },
    transfer: [decoded.rgba],
  };
}

/** One level of the mounted VFS, for the asset browser. Never recursive: a
 *  Gothic install is tens of thousands of entries. */
function assets(payload: { path: string }): { result: VfsEntry[] | null; transfer: ArrayBuffer[] } {
  return { result: zenkit.vfsList(vfs!, payload.path), transfer: [] };
}

/** The waynet as a drawable graph. Small next to the geometry — NewWorld's is
 *  a few thousand points — so the buffers are copied rather than transferred,
 *  and the worker keeps its own world intact. */
function waynet(): { result: WaynetPayload; transfer: ArrayBuffer[] } {
  return { result: phase('waynet', () => zenkit.getWaynet(handle!)), transfer: [] };
}

/**
 * The bounds of a visual a VOB is being *given* — the one thing a property edit
 * needs that is not already in the renderer.
 *
 * Every other op refits its box from bounds that crossed with the geometry. A
 * visual the world does not currently use has no instance and no payload, so it
 * has to be extracted here, where the VFS is. Null for a name that does not
 * resolve, which is a normal fact about a world rather than an error.
 */
function boundsOfVisual(
  payload: VisualBoundsRequest,
): { result: ZenBounds | null; transfer: ArrayBuffer[] } {
  return { result: visualBounds(binding, vfs!, payload.name), transfer: [] };
}

/**
 * An edit (level-editor.md §7, Phase 1b). The world in this thread is the
 * authoritative one; the renderer's index is a projection of it.
 *
 * `setVobPosition` is the mutation the engine has actually accepted — the
 * acceptance record's row 10 moved a VOB through it and the real game loaded
 * the result — and it moves the bbox with the position, which the engine culls
 * by. `setVobRotation` takes the refitted box instead of deriving one, because
 * the box is a pure function of (visual, rotation, position) and the op already
 * carries both poses' boxes; the engine has **not** accepted a rotated VOB yet,
 * and that is Gate 2's business. `setVobProp` writes only the keys the op names
 * and refuses an unrecognised one, and it takes a box only for a visual swap —
 * the one property change that can move the box. The batch is atomic, and the
 * index this thread keeps is updated only after the world is, so `visuals` never
 * places a VOB where an op failed to move it.
 */
function applyOpsRequest(payload: ApplyOpsRequest): { result: null; transfer: ArrayBuffer[] } {
  commitOps(
    {
      setVobPosition: (path, to) => zenkit.setVobPosition(handle!, path, to),
      setVobRotation: (path, to, bbox) => zenkit.setVobRotation(handle!, path, to, bbox),
      setVobProp: (path, props) => zenkit.setVobProp(handle!, path, props),
      insertVob: (spec) => zenkit.insertVob(handle!, spec),
      deleteVob: (path) => zenkit.deleteVob(handle!, path),
      reparentVob: (from, parentPath, slot) => zenkit.reparentVob(handle!, from, parentPath, slot),
    },
    payload.ops,
  );
  // A structural op changes how many VOBs there are, so the columnar projection
  // cannot be patched — `applyOps` refuses one by name. The index this thread
  // keeps is re-read instead, and the renderer asks for it with `refreshIndex`.
  if (payload.ops.some(isStructuralOp)) index = zenkit.vobIndex(handle!);
  else applyOps(createVobReader(index!), payload.ops);
  return { result: null, transfer: [] };
}

/**
 * Write the world out (level-editor.md §5, §7).
 *
 * The binding refuses a world that was not loaded from a `zCArchiverBinSafe`
 * archive — the only writer path verified byte-for-byte against the retail
 * corpus and in the original engine — and that refusal is passed through rather
 * than worked around: ZenKit's ASCII writer corrupts every raw entry it emits
 * and cannot re-load its own output. It writes to a temp file and renames, so a
 * failed save leaves the target as it was.
 *
 * `{ allowNonBinSafe: true }` exists for diagnostics and is deliberately not
 * reachable from the app.
 */
function save(payload: SaveWorldRequest): { result: null; transfer: ArrayBuffer[] } {
  phase('save', () => zenkit.saveWorld(handle!, payload.targetPath));
  return { result: null, transfer: [] };
}

function close(): { result: null; transfer: ArrayBuffer[] } {
  // A live VFS keeps every mounted file memory-mapped and Windows refuses to
  // delete a mapped file until the handle is collected (zenkit-node README), so
  // the references are dropped rather than merely gone out of scope.
  handle = null;
  vfs = null;
  index = null;
  worldMesh = null;
  openedPath = null;
  worldBbox = null;
  openedStats = null;
  return { result: null, transfer: [] };
}

if (parentPort) {
  parentPort.on('message', (message: WorldWorkerRequest) => {
    try {
      const { result, transfer } = run(message);
      parentPort!.postMessage({ id: message.id, ok: true, result }, transfer);
    } catch (error) {
      parentPort!.postMessage({
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function run(message: WorldWorkerRequest): { result: unknown; transfer: ArrayBuffer[] } {
  switch (message.op) {
    case 'open': return open(message.payload as OpenWorldRequest);
    case 'worldMesh': return takeWorldMesh();
    case 'visuals': return visuals();
    case 'texture': return texture(message.payload as { name: string; maxSize: number });
    case 'assets': return assets(message.payload as { path: string });
    case 'waynet': return waynet();
    case 'visualBounds': return boundsOfVisual(message.payload as VisualBoundsRequest);
    case 'refreshIndex': return refreshIndex();
    case 'applyOps': return applyOpsRequest(message.payload as ApplyOpsRequest);
    case 'save': return save(message.payload as SaveWorldRequest);
    case 'close': return close();
  }
}
