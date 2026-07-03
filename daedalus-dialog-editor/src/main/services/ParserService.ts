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
  worker: Worker;
  timer: NodeJS.Timeout;
}

export interface ParserServiceOptions {
  workerPath?: string;
  timeoutMs?: number;
  workerCount?: number;
}

export class ParserService {
  private workers: Worker[] = [];
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private nextWorkerIndex = 0;
  private readonly workerPath: string;
  private readonly timeoutMs: number;
  private restartTimestamps: number[] = [];
  private degraded = false;

  constructor(options: ParserServiceOptions = {}) {
    // Worker is located at ../workers/parser.worker.js relative to this file.
    // Both files compile to the same relative structure in dist/main.
    this.workerPath = options.workerPath ?? path.join(__dirname, '../workers/parser.worker.js');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;

    // Limit to 8 to avoid excessive memory usage, but at least 2 for parallelism.
    const numCPUs = os.cpus().length;
    const workerCount = options.workerCount ?? Math.max(2, Math.min(numCPUs, 8));

    console.log(`[ParserService] Initializing worker pool with ${workerCount} workers`);

    for (let i = 0; i < workerCount; i++) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): Worker {
    const worker = new Worker(this.workerPath, {
      // Runaway memory becomes a catchable ERR_WORKER_OUT_OF_MEMORY 'error'
      // event instead of an OS-level kill of the shared main process.
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });

    worker.on('message', (message: { id: string; result?: any; error?: string }) => {
      this.handleMessage(message);
    });

    worker.on('error', (err) => {
      this.handleWorkerDeath(worker, `error: ${err.message}`);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        this.handleWorkerDeath(worker, `exit code ${code}`);
      }
    });

    worker.on('messageerror', (err) => {
      // No request id is available on this event; the per-request timeout is the
      // backstop that settles the orphaned request.
      console.error('[ParserService] worker messageerror:', err);
    });

    this.workers.push(worker);
    return worker;
  }

  private handleMessage(message: { id: string; result?: any; error?: string }) {
    const { id, result, error } = message;
    const pending = this.pendingRequests.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(id);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
  }

  private handleTimeout(id: string) {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;

    this.pendingRequests.delete(id);
    pending.reject(new WorkerRequestError('Parser request timed out', 'timeout'));

    // A hung native parse cannot be cancelled; terminate() is best-effort (a
    // thread wedged inside tree-sitter native code may not die until it
    // returns). Removing the worker from rotation is the real protection.
    this.retireWorker(pending.worker, 'Parser worker terminated after a request timed out');
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
    if (this.nextWorkerIndex >= this.workers.length) {
      this.nextWorkerIndex = 0;
    }

    // Requests queued behind the dead/hung worker can never be answered.
    for (const [id, pending] of this.pendingRequests) {
      if (pending.worker === worker) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
        pending.reject(new WorkerRequestError(crashMessage, 'worker-crashed'));
      }
    }

    void worker.terminate();

    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS);
    this.restartTimestamps.push(now);

    if (this.restartTimestamps.length > MAX_RESTARTS_IN_WINDOW) {
      this.degraded = true;
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(
          new WorkerRequestError('Parser workers are crash-looping — restart the app', 'worker-crashed'),
        );
      }
      this.pendingRequests.clear();
      return;
    }

    this.spawnWorker();
  }

  private getNextWorker(): Worker {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
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

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const worker = this.getNextWorker();
      const timer = setTimeout(() => this.handleTimeout(id), this.timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, worker, timer });
      worker.postMessage({ id, sourceCode });
    });
  }

  /** Terminate all workers and clear pending state (test/teardown helper). */
  dispose() {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
    }
    this.pendingRequests.clear();
    this.workers.forEach((w) => void w.terminate());
    this.workers = [];
  }
}
