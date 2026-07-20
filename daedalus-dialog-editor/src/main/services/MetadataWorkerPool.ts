import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import type { DialogMetadata } from '../../shared/types';
import { promises as fsPromises } from 'fs';
import { decodeBuffer } from '../utils/encodingUtils';
import { WorkerRequestError } from './WorkerRequestError';

const DEFAULT_TASK_TIMEOUT_MS = 30000;

export interface MetadataResult {
  dialogs: DialogMetadata[];
  instances: Array<{ name: string; parent: string }>;
  prototypes: Array<{ name: string; parent: string }>;
  isQuestFile: boolean;
  routines: string[];
  voiceIds: Array<{ id: string; functionName: string }>;
}

// ProjectService.buildProjectIndex surfaces this failure shape to the project
// index as ProjectIndex.metadataFailures (the file is otherwise treated as
// empty metadata so the index build survives per-file failures).
export interface MetadataFailure {
  ok: false;
  filePath: string;
  error: string;
}

export type ProcessFileResult = MetadataResult | MetadataFailure;

interface PendingTask {
  resolve: (value: ProcessFileResult) => void;
  reject: (reason?: any) => void;
}

interface Task {
  id: string;
  filePath: string;
  retries: number;
}

interface InFlight {
  id: string;
  filePath: string;
  retries: number;
  timer: NodeJS.Timeout;
}

export interface MetadataWorkerPoolOptions {
  workerPath?: string;
  forceWorkerMode?: boolean;
  taskTimeoutMs?: number;
  maxRestarts?: number;
}

function isLikelyTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
}

export class MetadataWorkerPool {
  private workers: Worker[] = [];
  private pendingRequests: Map<string, PendingTask> = new Map();
  private idleWorkers: Worker[] = [];
  private taskQueue: Task[] = [];
  private inFlightByWorker: Map<Worker, InFlight> = new Map();
  private isTerminated = false;
  private isDegraded = false;
  private useInlineProcessing = false;
  private workerPath = '';
  private readonly taskTimeoutMs: number;
  private readonly maxRestarts: number;
  private restartCount = 0;

  constructor(options: MetadataWorkerPoolOptions = {}) {
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;

    if (!options.forceWorkerMode && isLikelyTestRuntime()) {
      // Jest should execute the current TS sources, not a potentially stale dist worker build.
      this.useInlineProcessing = true;
      this.maxRestarts = 0;
      return;
    }

    // Leave one core for the main thread/event loop; cap to bound native
    // parser instances (each loads the parser and uses tens of MB).
    const numWorkers = Math.max(1, Math.min(os.cpus().length - 1, 8));
    this.maxRestarts = options.maxRestarts ?? numWorkers * 3;
    this.workerPath = this.resolveWorkerPath(options.workerPath);

    for (let i = 0; i < numWorkers; i++) {
      const worker = this.spawnWorker();
      this.idleWorkers.push(worker);
    }
  }

  private resolveWorkerPath(override?: string): string {
    if (override) {
      if (!fs.existsSync(override)) {
        throw new Error(`Metadata worker entry was not found at ${override}.`);
      }
      return override;
    }

    // Worker path relative to dist/main/services/MetadataWorkerPool.js
    let workerPath = path.join(__dirname, '../workers/metadata.worker.js');

    // In a TS environment __dirname points at src/..., where the compiled
    // worker does not exist; fall back to the dist build.
    if (!fs.existsSync(workerPath)) {
      const distPath = path.join(__dirname, '../../../dist/main/workers/metadata.worker.js');
      if (fs.existsSync(distPath)) {
        workerPath = distPath;
      }
    }

    if (!fs.existsSync(workerPath)) {
      throw new Error(`Metadata worker entry was not found at ${workerPath}. Build the app/workers before runtime.`);
    }

    return workerPath;
  }

  private spawnWorker(): Worker {
    const worker = new Worker(this.workerPath, {
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });

    worker.on('message', (message: {
      id: string;
      dialogs?: DialogMetadata[];
      instances?: Array<{ name: string; parent: string }>;
      prototypes?: Array<{ name: string; parent: string }>;
      isQuestFile?: boolean;
      routines?: string[];
      voiceIds?: Array<{ id: string; functionName: string }>;
      error?: string;
    }) => {
      this.handleMessage(worker, message);
    });

    worker.on('error', () => this.handleWorkerDeath(worker));

    worker.on('exit', (code) => {
      if (code !== 0) {
        this.handleWorkerDeath(worker);
      }
    });

    worker.on('messageerror', (err) => {
      console.error('[MetadataWorkerPool] worker messageerror:', err);
    });

    this.workers.push(worker);
    return worker;
  }

  private handleMessage(worker: Worker, message: {
    id: string;
    dialogs?: DialogMetadata[];
    instances?: Array<{ name: string; parent: string }>;
    prototypes?: Array<{ name: string; parent: string }>;
    isQuestFile?: boolean;
    routines?: string[];
    voiceIds?: Array<{ id: string; functionName: string }>;
    error?: string;
  }) {
    const { id, dialogs, instances, prototypes, isQuestFile, routines, voiceIds, error } = message;

    const inFlight = this.inFlightByWorker.get(worker);
    if (inFlight && inFlight.id === id) {
      clearTimeout(inFlight.timer);
      this.inFlightByWorker.delete(worker);
    }

    const pending = this.pendingRequests.get(id);
    if (pending) {
      this.pendingRequests.delete(id);
      if (error) {
        // Per-file parse/read error: resolve as a failure so the index build survives.
        pending.resolve({ ok: false, filePath: inFlight?.filePath ?? '', error });
      } else {
        pending.resolve({
          dialogs: dialogs || [],
          instances: instances || [],
          prototypes: prototypes || [],
          isQuestFile: !!isQuestFile,
          routines: routines || [],
          voiceIds: voiceIds || [],
        });
      }
    }

    this.workerBecameIdle(worker);
  }

  private assignTask(worker: Worker, task: Task) {
    const timer = setTimeout(() => this.handleTimeout(worker, task), this.taskTimeoutMs);
    this.inFlightByWorker.set(worker, { id: task.id, filePath: task.filePath, retries: task.retries, timer });
    worker.postMessage({ id: task.id, filePath: task.filePath });
  }

  private workerBecameIdle(worker: Worker) {
    if (this.isTerminated) return;
    if (!this.workers.includes(worker)) return; // retired worker

    const task = this.taskQueue.shift();
    if (task) {
      this.assignTask(worker, task);
    } else {
      this.idleWorkers.push(worker);
    }
  }

  private handleTimeout(worker: Worker, task: Task) {
    const inFlight = this.inFlightByWorker.get(worker);
    if (!inFlight || inFlight.id !== task.id) return; // already settled

    this.inFlightByWorker.delete(worker);

    const pending = this.pendingRequests.get(task.id);
    if (pending) {
      this.pendingRequests.delete(task.id);
      pending.resolve({ ok: false, filePath: task.filePath, error: 'Metadata worker timed out' });
    }

    // A hung native parse cannot be cancelled; terminate() is best-effort.
    this.replaceDeadWorker(worker, null);
  }

  private handleWorkerDeath(worker: Worker) {
    if (this.isTerminated) return;
    if (!this.workers.includes(worker)) return; // error + exit double-fire, or already handled

    const inFlight = this.inFlightByWorker.get(worker);
    if (inFlight) {
      clearTimeout(inFlight.timer);
      this.inFlightByWorker.delete(worker);
    }

    let retryTask: Task | null = null;
    if (inFlight) {
      if (inFlight.retries >= 1) {
        // Poison-file guard: it already killed a replacement once. Record as failed.
        const pending = this.pendingRequests.get(inFlight.id);
        if (pending) {
          this.pendingRequests.delete(inFlight.id);
          pending.resolve({
            ok: false,
            filePath: inFlight.filePath,
            error: 'Metadata worker crashed while processing file',
          });
        }
      } else {
        retryTask = { id: inFlight.id, filePath: inFlight.filePath, retries: inFlight.retries + 1 };
      }
    }

    this.replaceDeadWorker(worker, retryTask);
  }

  private replaceDeadWorker(worker: Worker, retryTask: Task | null) {
    const wi = this.workers.indexOf(worker);
    if (wi !== -1) this.workers.splice(wi, 1);
    const ii = this.idleWorkers.indexOf(worker);
    if (ii !== -1) this.idleWorkers.splice(ii, 1);
    void worker.terminate();

    this.restartCount++;
    if (this.restartCount > this.maxRestarts) {
      this.enterDegraded();
      return;
    }

    const replacement = this.spawnWorker();
    if (retryTask) {
      this.assignTask(replacement, retryTask);
    } else {
      // Restore the queue lane so pending/queued tasks keep draining.
      this.workerBecameIdle(replacement);
    }
  }

  private enterDegraded() {
    this.isDegraded = true;

    for (const [, inFlight] of this.inFlightByWorker) {
      clearTimeout(inFlight.timer);
    }
    this.inFlightByWorker.clear();

    // Reject every remaining pending + queued task so buildProjectIndex's
    // Promise.all rejects and its finally runs terminate().
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new WorkerRequestError('Metadata workers are crash-looping — restart the app', 'worker-crashed'));
    }
    this.pendingRequests.clear();
    this.taskQueue = [];
  }

  public processFile(filePath: string): Promise<ProcessFileResult> {
    if (this.isTerminated) {
      return Promise.reject(new WorkerRequestError('Metadata pool terminated', 'pool-terminated'));
    }
    if (this.isDegraded) {
      return Promise.reject(
        new WorkerRequestError('Metadata workers are crash-looping — restart the app', 'worker-crashed'),
      );
    }

    if (this.useInlineProcessing) {
      return this.processFileInline(filePath);
    }

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pendingRequests.set(id, { resolve, reject });

      const task: Task = { id, filePath, retries: 0 };
      const worker = this.idleWorkers.pop();
      if (worker) {
        this.assignTask(worker, task);
      } else {
        this.taskQueue.push(task);
      }
    });
  }

  private async processFileInline(filePath: string): Promise<ProcessFileResult> {
    try {
      const buffer = await fsPromises.readFile(filePath);
      const { content } = decodeBuffer(buffer);
      // Lazy require: semanticMetadataUtils loads the native tree-sitter
      // addon, which must not be pulled into Jest module registries that only
      // exercise the worker path (re-loading the addon in a second registry in
      // the same process corrupts it).
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy require, see comment above
      const { extractFileMetadataFromSource } = require('../utils/semanticMetadataUtils');
      return extractFileMetadataFromSource(content, filePath);
    } catch (error) {
      // Match worker-path behavior: tolerate per-file processing failures.
      return { ok: false, filePath, error: error instanceof Error ? error.message : String(error) };
    }
  }

  public terminate() {
    if (this.isTerminated) return;
    this.isTerminated = true;

    for (const [, inFlight] of this.inFlightByWorker) {
      clearTimeout(inFlight.timer);
    }
    this.inFlightByWorker.clear();

    // Reject every entry still awaiting (pending + queued share pendingRequests).
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new WorkerRequestError('Metadata pool terminated', 'pool-terminated'));
    }
    this.pendingRequests.clear();
    this.taskQueue = [];

    this.workers.forEach((w) => void w.terminate());
    this.workers = [];
    this.idleWorkers = [];
  }
}
