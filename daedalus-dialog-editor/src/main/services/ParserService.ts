import { Worker } from 'worker_threads';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as os from 'os';

export class ParserService {
  private workers: Worker[] = [];
  private pendingRequests: Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>;
  private nextWorkerIndex = 0;

  constructor() {
    this.pendingRequests = new Map();

    // Worker is located at ../workers/parser.worker.js relative to this file
    // This works because both files are compiled to the same relative structure in dist/main
    const workerPath = path.join(__dirname, '../workers/parser.worker.js');

    // Create a pool of workers based on CPU count
    // Limit to 8 to avoid excessive memory usage, but at least 2 for parallelism
    const numCPUs = os.cpus().length;
    const workerCount = Math.max(2, Math.min(numCPUs, 8));

    console.log(`[ParserService] Initializing worker pool with ${workerCount} workers`);

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerPath);
      this.setupWorker(worker, i);
      this.workers.push(worker);
    }
  }

  private setupWorker(worker: Worker, index: number) {
    worker.on('message', (message: { id: string; result?: any; error?: string }) => {
      const { id, result, error } = message;
      const pending = this.pendingRequests.get(id);

      if (pending) {
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(result);
        }
        this.pendingRequests.delete(id);
      }
    });

    worker.on('error', (err) => {
        console.error(`Parser Worker ${index} error:`, err);
    });

    worker.on('exit', (code) => {
        if (code !== 0) {
            console.error(`Parser Worker ${index} stopped with exit code ${code}`);
        }
        // In a robust system, we might want to restart the worker here
    });
  }

  private getNextWorker(): Worker {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  /**
   * Parse Daedalus source code and return semantic model asynchronously
   * Offloads parsing to a worker thread pool to avoid blocking the main process
   */
  async parseSource(sourceCode: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pendingRequests.set(id, { resolve, reject });
      
      const worker = this.getNextWorker();
      worker.postMessage({ id, sourceCode });
    });
  }
}
