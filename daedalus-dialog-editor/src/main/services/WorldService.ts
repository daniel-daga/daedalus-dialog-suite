import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { invertOp } from 'zen-world';
import { WorkerRequestError } from './WorkerRequestError';
import type {
  DecodedTexture,
  InstancedPayload,
  OpenWorldRequest,
  VfsEntry,
  WaynetPayload,
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

  constructor(options: WorldServiceOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.createWorker = options.createWorker
      ?? (() => new Worker(resolveWorkerPath(options.workerPath)));
  }

  async openWorld(request: OpenWorldRequest): Promise<WorldSummary> {
    if (this.worker === null) this.startWorker();
    const summary = await this.request<WorldSummary>('open', request);
    this.worldPath = request.worldPath;
    this.undoStack = [];
    this.redoStack = [];
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

  /**
   * Apply an edit to the authoritative world, and record it (§7).
   *
   * A batch is one entry in the history: a multi-select drag is one undo, not
   * one per VOB. Nothing is recorded until the worker has confirmed the batch,
   * because the inverse of an edit that never happened moves a VOB that was
   * never moved.
   */
  async applyOps(ops: readonly WorldOp[]): Promise<void> {
    await this.requestOnOpenWorld<null>('applyOps', { ops });
    this.undoStack.push([...ops]);
    this.redoStack.length = 0;
  }

  /** Replay the last batch's inverses; false when there is nothing to undo. */
  undo(): Promise<boolean> {
    return this.replay(this.undoStack, this.redoStack, true);
  }

  /** Replay the last undone batch as it was; false when there is nothing. */
  redo(): Promise<boolean> {
    return this.replay(this.redoStack, this.undoStack, false);
  }

  /**
   * Undo and redo are the same move in opposite directions: take the top batch
   * off one stack, send it through the ordinary `applyOps` path, and put it on
   * the other. Undo sends the inverses **back to front** — two ops on the same
   * VOB in one batch compose, and undoing them front to back leaves it where
   * the first op put it.
   */
  private async replay(
    from: WorldOp[][], to: WorldOp[][], invert: boolean,
  ): Promise<boolean> {
    const batch = from[from.length - 1];
    if (batch === undefined) return false;

    const ops = invert ? [...batch].reverse().map(invertOp) : batch;
    await this.requestOnOpenWorld<null>('applyOps', { ops });

    // Moved only once the worker has confirmed it, so a refused replay leaves
    // the history where it was rather than one step out of step with the world.
    from.pop();
    to.push(batch);
    return true;
  }

  close(): void {
    this.failure ??= new WorkerRequestError('The world was closed', 'world-closed');
    this.rejectAll(this.failure);
    this.worldPath = null;
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
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WorkerRequestError(`${op} did not answer in ${this.requestTimeoutMs} ms`, 'world-timeout'));
      }, this.requestTimeoutMs);

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

  private handleWorkerDeath(error: Error): void {
    if (this.failure !== null) return; // error + exit double-fire
    this.failure = new WorkerRequestError(
      `The world worker died (${error.message}) — reopen the world`, 'world-crashed',
    );
    this.rejectAll(this.failure);
    this.worldPath = null;
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
