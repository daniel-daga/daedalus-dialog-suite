import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import type { DialogMetadata } from '../../shared/types';

interface PendingTask {
  resolve: (value: { dialogs: DialogMetadata[]; isQuestFile: boolean }) => void;
  reject: (reason?: any) => void;
}

export class MetadataWorkerPool {
  private workers: Worker[] = [];
  private pendingRequests: Map<string, PendingTask> = new Map();
  private idleWorkers: Worker[] = [];
  private taskQueue: { id: string; filePath: string }[] = [];
  private isTerminated = false;

  constructor() {
    // Leave one core for the main thread/event loop
    const numWorkers = Math.max(1, os.cpus().length - 1);

    // Worker path relative to dist/main/services/MetadataWorkerPool.js
    let workerPath = path.join(__dirname, '../workers/metadata.worker.js');

    // If running in TS environment (tests), the worker file won't exist at the relative path
    // because __dirname points to src/...
    // We need to point to the compiled worker in dist
    if (!fs.existsSync(workerPath)) {
      // From src/main/services -> ../../../ -> root -> dist/main/main/workers/metadata.worker.js
      const distPath = path.join(__dirname, '../../../dist/main/main/workers/metadata.worker.js');
      if (fs.existsSync(distPath)) {
        workerPath = distPath;
      }
    }

    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(workerPath);

      worker.on('message', (message: { id: string; dialogs?: DialogMetadata[]; isQuestFile?: boolean; error?: string }) => {
        const { id, dialogs, isQuestFile, error } = message;
        const pending = this.pendingRequests.get(id);

        if (pending) {
          if (error) {
            // On error, we resolve with empty result to continue processing other files
            // consistent with original ProjectService behavior
            pending.resolve({ dialogs: [], isQuestFile: false });
          } else {
            pending.resolve({ dialogs: dialogs || [], isQuestFile: !!isQuestFile });
          }
          this.pendingRequests.delete(id);
        }

        this.workerBecameIdle(worker);
      });

      worker.on('error', (err) => {
        console.error('Metadata Worker error:', err);
      });

      worker.on('exit', (code) => {
         if (code !== 0 && !this.isTerminated) {
             console.error(`Metadata Worker exited with code ${code}`);
         }
      });

      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  private workerBecameIdle(worker: Worker) {
    if (this.isTerminated) return;

    if (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift()!;
      worker.postMessage(task);
    } else {
      this.idleWorkers.push(worker);
    }
  }

  public processFile(filePath: string): Promise<{ dialogs: DialogMetadata[]; isQuestFile: boolean }> {
    if (this.isTerminated) {
        return Promise.reject(new Error('Pool terminated'));
    }

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pendingRequests.set(id, { resolve, reject });

      const worker = this.idleWorkers.pop();
      if (worker) {
        worker.postMessage({ id, filePath });
      } else {
        this.taskQueue.push({ id, filePath });
      }
    });
  }

  public terminate() {
    this.isTerminated = true;
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.idleWorkers = [];
    this.taskQueue = [];
    this.pendingRequests.clear();
  }
}
