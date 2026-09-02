import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { invertOp, isBarrierOp } from 'zen-world';
import { WorkerRequestError } from './WorkerRequestError';
import type {
  DecodedTexture,
  VisualScene,
  InstancedPayload,
  OpenWorldRequest,
  VfsEntry,
  WaynetPayload,
  PortalFindingsPayload,
  WorldMeshPayload,
  WorldOp,
  WorldSummary,
  WorldWorkerOp,
  WorldWorkerRequest,
  WorldWorkerResponse,
} from '../../shared/worldTypes';

// The owner of the one zenkit worker that holds the world in memory
// (level-editor.md §7). MetadataWorkerPool is the precedent for the mechanics —
// ids, timeouts, a dead worker — but not for the policy, because that pool is a
// set of interchangeable stateless workers and this is one stateful one:
//
//   - it is never restarted behind the caller's back. The world it held is
//     gone, along with any op applied to it, and silently re-loading would turn
//     a crash into lost work with no report.
//   - it is not spawned until a world is opened, so the native addon stays out
//     of dialog-only sessions (§6: the World surface is lazily loaded).
//
// One honest limit on the isolation §7 claims: a worker thread survives a JS
// throw in the addon, but ZenKit can also abort the process outright
// (`0xC0000409`, seen on the ASCII path), and an abort in a worker thread takes
// the whole Electron main process with it. The worker boundary buys crash
// *reporting* and a non-blocking UI, not immunity.

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/** The slice of `worker_threads.Worker` this service uses — injected in tests. */
export interface WorldWorker {
  postMessage(message: WorldWorkerRequest, transferList?: readonly ArrayBuffer[]): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'exit', handler: (code: number) => void): void;
  on(event: 'message', handler: (message: WorldWorkerResponse) => void): void;
  terminate(): Promise<number> | void;
}

export interface WorldServiceOptions {
  createWorker?: () => WorldWorker;
  workerPath?: string;
  requestTimeoutMs?: number;
}

interface Pending {
  reject: (reason: Error) => void;
  resolve: (value: never) => void;
  timer: NodeJS.Timeout;
}

export class WorldService {
  private worker: WorldWorker | null = null;
  private pending = new Map<string, Pending>();
  private readonly requestTimeoutMs: number;
  private readonly createWorker: () => WorldWorker;
  private worldPath: string | null = null;
  private failure: WorkerRequestError | null = null;
  // The authoritative history (§7). A batch is one entry. Both stacks belong to
  // the world that is open: an op addresses a VOB by its index path down *that*
  // world's tree, and replayed against the next one it would resolve to
  // whatever happens to sit at that path.
  private undoStack: WorldOp[][] = [];
  private redoStack: WorldOp[][] = [];
  /** Edits run one at a time — see `serialized`. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: WorldServiceOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.createWorker = options.createWorker
      ?? (() => new Worker(resolveWorkerPath(options.workerPath)));
  }

  /**
   * Load a world into the worker, and start an empty history over it.
   *
   * The history and `worldPath` are dropped **before** the request rather than
   * after it. An open is a multi-second `loadWorld`, Ctrl+Z is bound the whole
   * time, and this is deliberately not `serialized` — it is not an edit and it
   * must not wait behind one. So an undo pressed mid-open would otherwise find
   * the previous world's non-null `worldPath` and push A's inverse batch into
   * the worker's FIFO behind the open, writing A's index paths into B and then
   * losing the evidence when the open cleared the stacks. Cleared first, the
   * replay finds nothing to replay and every other request is refused by
   * `requestOnOpenWorld` — the same "refused rather than queued" rule that
   * covers the moment before the first world opens.
   *
   * That leaves a failed open with no world open, which is what it is: the
   * failure can be anywhere in the worker's load, so the world it holds is not
   * knowably the old one, and the renderer's `openFailed` resets the surface.
   */
  async openWorld(request: OpenWorldRequest): Promise<WorldSummary> {
    if (this.worker === null) this.startWorker();
    this.worldPath = null;
    this.undoStack = [];
    this.redoStack = [];
    const summary = await this.request<WorldSummary>('open', request);
    this.worldPath = request.worldPath;
    return summary;
  }

  getWorldMesh(): Promise<WorldMeshPayload> {
    return this.requestOnOpenWorld<WorldMeshPayload>('worldMesh');
  }

  getInstancedVisuals(): Promise<InstancedPayload> {
    return this.requestOnOpenWorld<InstancedPayload>('visuals');
  }

  /**
   * Textures are decoded on demand: decoding all 490 of NewWorld's eagerly is
   * 549 ms of the cold open and none of it is invalidated by an edit.
   *
   * `maxSize` picks a mipmap rather than resampling. Full-size for every
   * texture in NewWorld is ~490 MB of RGBA, which is why the spike's measured
   * scene used 256 — the caller decides, because it is a projection-layer call.
   */
  getTexture(name: string, maxSize = 256): Promise<DecodedTexture | null> {
    return this.requestOnOpenWorld<DecodedTexture | null>('texture', { name, maxSize });
  }

  /**
   * One level of the mounted VFS, for the asset browser. Null both for a path
   * that is not there and for a file — neither is something to list.
   *
   * Never recursive: the mounted namespace of a Gothic install is tens of
   * thousands of entries, and the browser shows one directory at a time.
   */
  listAssets(path = '/'): Promise<VfsEntry[] | null> {
    return this.requestOnOpenWorld<VfsEntry[] | null>('assets', { path });
  }

  /** The waynet as a drawable graph. Requested on demand: an overlay nobody
   *  turned on should not be in the cold open. */
  getWaynet(): Promise<WaynetPayload> {
    return this.requestOnOpenWorld<WaynetPayload>('waynet');
  }

  /** The portal checks' findings, computed in the worker over the world mesh
   *  (level-editor.md §16.20 slice 3). Requested once per open by the World
   *  surface, since no op touches the mesh. */
  getPortalFindings(): Promise<PortalFindingsPayload> {
    return this.requestOnOpenWorld<PortalFindingsPayload>('portalFindings');
  }

  /**
   * The bounds of a visual by name, for a VOB that is being given one.
   *
   * The only bounds in the system that has to be asked for: every other op
   * refits its box from bounds that already crossed with the geometry, and a
   * visual the world does not currently use has neither an instance nor a
   * payload. Null for a name that does not resolve.
   */
  getVisualBounds(name: string): Promise<number[] | null> {
    return this.requestOnOpenWorld<number[] | null>('visualBounds', { name });
  }

  /** One visual by name, merged as the scene would place it, for the Assets
   *  panel's mesh preview. Null for a name the binding cannot extract. */
  getVisual(name: string): Promise<VisualScene | null> {
    return this.requestOnOpenWorld<VisualScene | null>('visual', { name });
  }

  /**
   * The per-class fields of one VOB, by its native index path.
   *
   * Deliberately **not** inside `serialized`: that queue exists so two edits
   * cannot both read the same top of the undo stack, and this reads no stack and
   * unwinds nothing. Putting it there would make the property grid wait out an
   * edit's 120 s timeout to show a field, for no invariant at all — the world it
   * reads is the same one either way, and the renderer re-asks after every
   * applied batch.
   */
  getVobProps(path: string): Promise<Record<string, unknown>> {
    return this.requestOnOpenWorld<Record<string, unknown>>('vobProps', { path });
  }

  /**
   * The VOB enumeration again, after a structural edit changed it.
   *
   * A flat index is a VOB's position in a depth-first traversal, so an added VOB
   * changes how many there are and the renderer's columnar projection cannot be
   * patched. This re-reads the index from the world the worker already holds —
   * re-opening would re-load from disk and discard every edit.
   */
  refreshIndex(): Promise<WorldSummary> {
    return this.requestOnOpenWorld<WorldSummary>('refreshIndex');
  }

  /**
   * Apply an edit to the authoritative world, and record it (§7).
   *
   * A batch is one entry in the history: a multi-select drag is one undo, not
   * one per VOB. Nothing is recorded until the worker has confirmed the batch,
   * because the inverse of an edit that never happened moves a VOB that was
   * never moved.
   */
  applyOps(ops: readonly WorldOp[]): Promise<void> {
    return this.serialized(async () => {
      await this.requestOnOpenWorld<null>('applyOps', { ops });

      // A barrier op has no inverse (§15), and recording it would leave `undo`
      // reaching for one. Both stacks go, not just the entry it would have
      // made: a barrier is structural and renumbers, so every batch already on
      // the undo stack addresses VOBs by indices and paths this edit has just
      // moved — replaying one would edit whatever has since taken that address.
      // Cleared *after* the worker confirms, so a refused delete costs the user
      // nothing. The World surface warns before it lands; this is only the
      // half that cannot be worked around.
      if (ops.some(isBarrierOp)) {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        return;
      }

      this.undoStack.push([...ops]);
      this.redoStack.length = 0;
    });
  }

  /**
   * Write the world to `targetPath` (level-editor.md §5, §7).
   *
   * Serialised with the edits rather than run beside them: a save that
   * overlapped a batch would write a world in the middle of one, and `commitOps`
   * guarantees a batch is all-or-nothing only against callers that never read it
   * half-applied.
   *
   * The target is always explicit. The app never writes back over the file it
   * opened unless the user names it in the save dialog — the worlds it opens are
   * retail game files, and the acceptance workflow keeps a hash-verified
   * pristine backup for exactly that reason.
   */
  saveWorld(targetPath: string): Promise<void> {
    return this.serialized(async () => {
      await this.requestOnOpenWorld<null>('save', { targetPath });
    });
  }

  /**
   * Replay the last batch's inverses; null when there is nothing to undo.
   *
   * Answers with **the ops it applied**, not merely that it did. The renderer
   * holds a projection of this world and has to move the same VOBs in it; a
   * boolean would leave it either guessing or keeping a second history, and §7
   * puts the authoritative one here.
   */
  undo(): Promise<WorldOp[] | null> {
    return this.replay(this.undoStack, this.redoStack, true);
  }

  /** Replay the last undone batch as it was; null when there is nothing. */
  redo(): Promise<WorldOp[] | null> {
    return this.replay(this.redoStack, this.undoStack, false);
  }

  /**
   * How many batches each stack holds — not exposed elsewhere, because the
   * stacks themselves are private to this service (§7). It is how the World
   * bar's undo/redo buttons know whether there is anything to do, over the
   * IPC round trip `world:historyDepth` sends it through
   * (level-editor.md §17).
   */
  historyDepth(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  /**
   * Undo and redo are the same move in opposite directions: take the top batch
   * off one stack, send it through the ordinary `applyOps` path, and put it on
   * the other. Undo sends the inverses **back to front** — two ops on the same
   * VOB in one batch compose, and undoing them front to back leaves it where
   * the first op put it.
   */
  private replay(
    from: WorldOp[][], to: WorldOp[][], invert: boolean,
  ): Promise<WorldOp[] | null> {
    return this.serialized(() => this.replayOne(from, to, invert));
  }

  /**
   * One edit at a time, in the order it was asked for.
   *
   * Found by holding Ctrl+Z in the real app: every edit is an IPC round trip
   * and the stacks are moved only once the worker answers, so two overlapping
   * replays both read the same top of the stack and both apply it — the VOB
   * moves back twice and one entry never comes off. Serialising is the whole
   * fix; the alternative, moving the stacks before the worker confirms, is the
   * bug the test above pins.
   */
  private serialized<T>(run: () => Promise<T>): Promise<T> {
    // `then(run, run)`: the next edit runs whether or not the one before it was
    // refused. A refused edit changes nothing — the batch is atomic and nothing
    // is recorded — so it is no reason to stop taking edits.
    const next = this.queue.then(run, run);
    this.queue = next;
    return next;
  }

  private async replayOne(
    from: WorldOp[][], to: WorldOp[][], invert: boolean,
  ): Promise<WorldOp[] | null> {
    const batch = from[from.length - 1];
    if (batch === undefined) return null;

    const ops = invert ? [...batch].reverse().map(invertOp) : batch;
    await this.requestOnOpenWorld<null>('applyOps', { ops });

    // Moved only once the worker has confirmed it, so a refused replay leaves
    // the history where it was rather than one step out of step with the world.
    from.pop();
    to.push(batch);
    return ops;
  }

  close(): void {
    this.failure ??= new WorkerRequestError('The world was closed', 'world-closed');
    this.rejectAll(this.failure);
    this.worldPath = null;
    // The stacks belong to the world that was open — `openWorld` says why —
    // and closing ends that world as surely as opening the next one does.
    // Left standing they are not just stale but *readable*: `historyDepth`
    // is a plain getter with no `requestOnOpenWorld` guard, so it would go
    // on reporting a closed world's depths where every other read refuses.
    this.undoStack = [];
    this.redoStack = [];
    void this.worker?.terminate();
    this.worker = null;
  }

  private startWorker(): void {
    this.failure = null;
    const worker = this.createWorker();
    worker.on('error', (error) => this.handleWorkerDeath(error));
    worker.on('exit', (code) => {
      if (code !== 0) this.handleWorkerDeath(new Error(`zenkit worker exited with code ${code}`));
    });
    worker.on('message', (message) => this.handleMessage(message));
    this.worker = worker;
  }

  private requestOnOpenWorld<T>(op: WorldWorkerOp, payload?: unknown): Promise<T> {
    // Refused rather than queued: a queued request would be answered by
    // whatever world is opened next.
    if (this.worldPath === null && this.failure === null) {
      return Promise.reject(new Error('No world is open'));
    }
    return this.request<T>(op, payload);
  }

  private request<T>(op: WorldWorkerOp, payload?: unknown): Promise<T> {
    if (this.failure !== null) return Promise.reject(this.failure);

    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => this.handleTimeout(op), this.requestTimeoutMs);

      this.pending.set(id, { resolve: resolve as (value: never) => void, reject, timer });
      this.worker!.postMessage({ id, op, payload });
    });
  }

  private handleMessage(message: WorldWorkerResponse): void {
    const pending = this.pending.get(message.id);
    // A reply to a request that already timed out: the caller has been told it
    // failed, so resurrecting it here would settle a promise twice.
    if (!pending) return;

    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result as never);
    else pending.reject(new Error(message.error));
  }

  /**
   * A request that never answered takes the worker down with it.
   *
   * The thread is not idle — it is still inside the call that went quiet, and
   * the world it holds is in whatever state that call left it. Rejecting only
   * the caller would leave that thread spinning while `openWorld`'s
   * `worker === null` guard posts the retry straight back into it, so the
   * surface never recovers and every retry feeds the same stuck worker. Same
   * policy as a crash, for the same reason: the world is gone, and the user is
   * told to reopen it rather than being handed a silent reload.
   */
  private handleTimeout(op: WorldWorkerOp): void {
    if (this.failure !== null) return;
    this.failure = new WorkerRequestError(
      `${op} did not answer in ${this.requestTimeoutMs} ms — the world worker was stopped, reopen the world`,
      'world-timeout',
    );
    // Set before terminating: `terminate()` fires a non-zero `exit`, and
    // `handleWorkerDeath` would otherwise relabel this as a crash.
    this.rejectAll(this.failure);
    this.worldPath = null;
    void this.worker?.terminate();
    this.worker = null;
  }

  private handleWorkerDeath(error: Error): void {
    if (this.failure !== null) return; // error + exit double-fire
    this.failure = new WorkerRequestError(
      `The world worker died (${error.message}) — reopen the world`, 'world-crashed',
    );
    this.rejectAll(this.failure);
    this.worldPath = null;
    // Dropped like the timeout path drops it: the banner tells the user to
    // reopen the world, and `openWorld` starts a worker only when this is null.
    // Holding on to the dead one made that instruction impossible to follow,
    // since `startWorker` is also the only place `failure` is cleared.
    this.worker = null;
  }

  private rejectAll(error: WorkerRequestError): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function resolveWorkerPath(override?: string): string {
  if (override) return override;

  // Relative to dist/main/services/WorldService.js at runtime; from the TS
  // sources under a test runner __dirname points at src/, where no compiled
  // worker exists — same fallback MetadataWorkerPool uses.
  const built = path.join(__dirname, '../workers/zenkit.worker.js');
  if (fs.existsSync(built)) return built;

  const dist = path.join(__dirname, '../../../dist/main/workers/zenkit.worker.js');
  if (fs.existsSync(dist)) return dist;

  throw new Error(`zenkit worker entry was not found at ${built}. Build the app/workers before runtime.`);
}
