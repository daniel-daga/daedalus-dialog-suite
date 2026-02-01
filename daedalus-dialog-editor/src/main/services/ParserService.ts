import { Worker } from 'worker_threads';
import * as path from 'path';
import { randomUUID } from 'crypto';

export class ParserService {
  private worker: Worker;
  private pendingRequests: Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>;

  constructor() {
    this.pendingRequests = new Map();

    // Worker is located at ../workers/parser.worker.js relative to this file
    // This works because both files are compiled to the same relative structure in dist/main
    const workerPath = path.join(__dirname, '../workers/parser.worker.js');

    this.worker = new Worker(workerPath);

    this.worker.on('message', (message: { id: string; result?: any; error?: string }) => {
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

    this.worker.on('error', (err) => {
        console.error('Parser Worker error:', err);
    });

    this.worker.on('exit', (code) => {
        if (code !== 0) {
            console.error(`Parser Worker stopped with exit code ${code}`);
        }
    });
  }

  /**
   * Parse Daedalus source code and return semantic model asynchronously
   * Offloads parsing to a worker thread to avoid blocking the main process
   */
  async parseSource(sourceCode: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pendingRequests.set(id, { resolve, reject });
      this.worker.postMessage({ id, sourceCode });
    });
  }
}
