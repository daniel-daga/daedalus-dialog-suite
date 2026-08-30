import { Worker } from 'worker_threads';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as os from 'os';
import { WorkerRequestError } from './WorkerRequestError';

const DEFAULT_PARSE_TIMEOUT_MS = 30000;
const RESTART_WINDOW_MS = 60000;
const MAX_RESTARTS_IN_WINDOW = 5;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

interface QueuedRequest {
  id: string;
  sourceCode: string;
}

interface InFlight {
  id: string;
  timer: NodeJS.Timeout;
}

export interface ParserServiceOptions {
  workerPath?: string;
  timeoutMs?: number;
  workerCount?: number;
}

export class ParserService {
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private requestQueue: QueuedRequest[] = [];
  private inFlightByWorker: Map<Worker, InFlight> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly workerPath: string;
  private readonly timeoutMs: number;
  private readonly workerCount: number;
  private started = false;
  private restartTimestamps: number[] = [];
  private degraded = false;
  /**
   * `terminate()` is asynchronous: the thread is still alive — and its
   * MessagePort still an open handle in this process — until the returned
   * promise settles. A worker retired mid-run is therefore remembered here so
   * `dispose()` can wait for it too; otherwise teardown returns while a thread
   * is still running and nothing can tell when the process is free to exit.
   */
  private pendingTerminations: Array<Promise<number>> = [];

  constructor(options: ParserServiceOptions = {}) {
    // Worker is located at ../workers/parser.worker.js relative to this file.
    // Both files compile to the same relative structure in dist/main.
    this.workerPath = options.workerPath ?? path.join(__dirname, '../workers/parser.worker.js');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;

    // Limit to 8 to avoid excessive memory usage, but at least 2 for parallelism.
    const numCPUs = os.cpus().length;
    this.workerCount = options.workerCount ?? Math.max(2, Math.min(numCPUs, 8));
  }

  /**
   * The pool is not spawned until something actually asks for a parse — the
   * same laziness WorldService has, and for the same reason: `main.ts`
   * constructs this service at module load, and a dialog-only session (or a
   * test that only imports `main.ts`) should not inherit eight live threads.
   */
  private startPool() {
    this.started = true;

    console.log(`[ParserService] Initializing worker pool with ${this.workerCount} workers`);

    for (let i = 0; i < this.workerCount; i++) {
      const worker = this.spawnWorker();
      this.idleWorkers.push(worker);
    }
  }

  private spawnWorker(): Worker {
    const worker = new Worker(this.workerPath, {
      // Runaway memory becomes a catchable ERR_WORKER_OUT_OF_MEMORY 'error'
      // event instead of an OS-level kill of the shared main process.
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });

    worker.on('message', (message: { id: string; result?: any; error?: string }) => {
      this.handleMessage(worker, message);
    });

    worker.on('error', (err) => {
      this.handleWorkerDeath(worker, `error: ${err.message}`);
    });

    // Any exit is a death, code 0 included: a worker that walks off the end of
    // its own event loop can no longer answer the request in flight on it, and
    // treating a clean exit as normal left that request waiting out the 30 s
    // timeout. `retireWorker` is a no-op for a worker already out of the array,
    // so a deliberate `terminate()` — retire, or `dispose()` — stays quiet.
    worker.on('exit', (code) => {
      this.handleWorkerDeath(worker, `exit code ${code}`);
    });

    worker.on('messageerror', (err) => {
      // No request id is available on this event; the per-request timeout is the
      // backstop that settles the orphaned request.
      console.error('[ParserService] worker messageerror:', err);
    });

    this.workers.push(worker);
    return worker;
  }

  private handleMessage(worker: Worker, message: { id: string; result?: any; error?: string }) {
    const { id, result, error } = message;

    const inFlight = this.inFlightByWorker.get(worker);
    if (inFlight && inFlight.id === id) {
      clearTimeout(inFlight.timer);
      this.inFlightByWorker.delete(worker);
    }

    const pending = this.pendingRequests.get(id);
    if (pending) {
      this.pendingRequests.delete(id);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
    }

    this.workerBecameIdle(worker);
  }

  private assignRequest(worker: Worker, request: QueuedRequest) {
    const timer = setTimeout(() => this.handleTimeout(worker, request.id), this.timeoutMs);
    this.inFlightByWorker.set(worker, { id: request.id, timer });
    worker.postMessage({ id: request.id, sourceCode: request.sourceCode });
  }

  private workerBecameIdle(worker: Worker) {
    if (!this.workers.includes(worker)) return; // retired worker

    const request = this.requestQueue.shift();
    if (request) {
      this.assignRequest(worker, request);
    } else {
      this.idleWorkers.push(worker);
    }
  }

  private handleTimeout(worker: Worker, id: string) {
    const inFlight = this.inFlightByWorker.get(worker);
    if (!inFlight || inFlight.id !== id) return; // already settled

    this.inFlightByWorker.delete(worker);

    const pending = this.pendingRequests.get(id);
    if (pending) {
      this.pendingRequests.delete(id);
      pending.reject(new WorkerRequestError('Parser request timed out', 'timeout'));
    }

    // A hung native parse cannot be cancelled; terminate() is best-effort (a
    // thread wedged inside tree-sitter native code may not die until it
    // returns). Removing the worker from rotation is the real protection.
    this.retireWorker(worker, 'Parser worker terminated after a request timed out');
  }

  private handleWorkerDeath(worker: Worker, reason: string) {
    // error + exit can both fire for one crash; retireWorker is a no-op the
    // second time because the worker is already out of the array.
    this.retireWorker(worker, `Parser worker crashed (${reason})`);
  }

  private retireWorker(worker: Worker, crashMessage: string) {
    const index = this.workers.indexOf(worker);
    if (index === -1) return;

    this.workers.splice(index, 1);
    const idleIndex = this.idleWorkers.indexOf(worker);
    if (idleIndex !== -1) this.idleWorkers.splice(idleIndex, 1);

    // The request in flight on the dead/hung worker can never be answered.
    const inFlight = this.inFlightByWorker.get(worker);
    if (inFlight) {
      clearTimeout(inFlight.timer);
      this.inFlightByWorker.delete(worker);
      const pending = this.pendingRequests.get(inFlight.id);
      if (pending) {
        this.pendingRequests.delete(inFlight.id);
        pending.reject(new WorkerRequestError(crashMessage, 'worker-crashed'));
      }
    }

    this.pendingTerminations.push(worker.terminate());

    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS);
    this.restartTimestamps.push(now);

    if (this.restartTimestamps.length > MAX_RESTARTS_IN_WINDOW) {
      this.degraded = true;
      for (const [, orphan] of this.inFlightByWorker) {
        clearTimeout(orphan.timer);
      }
      this.inFlightByWorker.clear();
      // Reject every request still awaiting (in-flight + queued share pendingRequests).
      for (const [, pending] of this.pendingRequests) {
        pending.reject(
          new WorkerRequestError('Parser workers are crash-looping — restart the app', 'worker-crashed'),
        );
      }
      this.pendingRequests.clear();
      this.requestQueue = [];
      return;
    }

    const replacement = this.spawnWorker();
    // Restore the pool lane so queued requests keep draining.
    this.workerBecameIdle(replacement);
  }

  /**
   * Parse Daedalus source code and return semantic model asynchronously.
   * Offloads parsing to a worker thread pool to avoid blocking the main process.
   */
  async parseSource(sourceCode: string): Promise<any> {
    if (this.degraded) {
      return Promise.reject(
        new WorkerRequestError('Parser workers are crash-looping — restart the app', 'worker-crashed'),
      );
    }

    if (!this.started) this.startPool();

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pendingRequests.set(id, { resolve, reject });

      const request: QueuedRequest = { id, sourceCode };
      const worker = this.idleWorkers.pop();
      if (worker) {
        this.assignRequest(worker, request);
      } else {
        this.requestQueue.push(request);
      }
    });
  }

  /**
   * Terminate all workers and clear pending state (test/teardown helper).
   *
   * Resolves only once every thread has actually exited, so a caller can know
   * the process holds no worker handles any more.
   */
  async dispose(): Promise<void> {
    for (const [, inFlight] of this.inFlightByWorker) {
      clearTimeout(inFlight.timer);
    }
    this.inFlightByWorker.clear();
    this.pendingRequests.clear();
    this.requestQueue = [];
    const terminations = this.pendingTerminations.concat(this.workers.map((w) => w.terminate()));
    this.pendingTerminations = [];
    this.workers = [];
    this.idleWorkers = [];
    await Promise.all(terminations);
  }
}
