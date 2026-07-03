/**
 * MetadataWorkerPool worker-lifecycle tests (D2).
 *
 * forceWorkerMode bypasses the inline-processing test shortcut so real
 * worker_threads run against stub worker scripts.
 *
 * @jest-environment node
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { MetadataWorkerPool } from '../../src/main/services/MetadataWorkerPool';
import { WorkerRequestError } from '../../src/main/services/WorkerRequestError';

const FIXTURE_DIR = path.join(__dirname, '../fixtures/workers');
const workerFixture = (name: string) => path.join(FIXTURE_DIR, name);

const once = (emitter: { once: (e: string, cb: (...a: any[]) => void) => void }, event: string) =>
  new Promise<void>((resolve) => emitter.once(event, () => resolve()));

describe('MetadataWorkerPool worker lifecycle', () => {
  const pools: MetadataWorkerPool[] = [];

  function makePool(fixture: string, overrides: Record<string, unknown> = {}): MetadataWorkerPool {
    const pool = new MetadataWorkerPool({
      workerPath: workerFixture(fixture),
      forceWorkerMode: true,
      // Large so a real crash event wins the race against the timeout backstop.
      taskTimeoutMs: 5000,
      ...overrides,
    });
    pools.push(pool);
    return pool;
  }

  afterEach(() => {
    while (pools.length) {
      pools.pop()!.terminate();
    }
  });

  it('settles a file as failure when its worker exits mid-task', async () => {
    const pool = makePool('exit.worker.js');

    const result: any = await pool.processFile('__CRASH__');

    expect(result.ok).toBe(false);
    expect(result.filePath).toBe('__CRASH__');
  });

  it('recovers when a worker dies while idle and still processes the next task', async () => {
    const pool = makePool('echo.worker.js');

    // Prime: one task completes, all workers end idle.
    await pool.processFile('first');

    // Kill every worker while idle. Buggy code leaves the dead workers in the
    // idle pool with no replacement, so the next task hangs.
    const workers: any[] = (pool as any).workers.slice();
    await Promise.all(
      workers.map((w) => {
        const exited = once(w, 'exit');
        w.terminate();
        return exited;
      }),
    );

    await expect(pool.processFile('second')).resolves.toBeDefined();
  });

  it('drains a queue longer than the pool when a worker crashes once', async () => {
    const marker = path.join(
      os.tmpdir(),
      `metadata-crash-once-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.CRASH_ONCE_MARKER = marker;
    try {
      const pool = makePool('crash-once.worker.js');

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => pool.processFile(`file-${i}`)),
      );

      expect(results).toHaveLength(6);
    } finally {
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
      delete process.env.CRASH_ONCE_MARKER;
    }
  });

  it('rejects pending and queued tasks with pool-terminated on terminate()', async () => {
    const pool = makePool('hang.worker.js');

    // Submit more tasks than workers so some sit queued.
    const promises = Array.from({ length: 10 }, (_, i) => pool.processFile(`file-${i}`));
    const captured = promises.map((p) => p.catch((e) => e));

    // Give the pool a tick to assign the first batch.
    await new Promise((r) => setImmediate(r));

    pool.terminate();

    const settled = await Promise.all(captured);
    for (const err of settled) {
      expect(err).toBeInstanceOf(WorkerRequestError);
      expect(err.kind).toBe('pool-terminated');
    }

    // Idempotent.
    expect(() => pool.terminate()).not.toThrow();
  });

  it('rejects remaining tasks once the restart cap is exceeded', async () => {
    const pool = makePool('exit.worker.js', { maxRestarts: 2 });

    const all = Promise.all(Array.from({ length: 6 }, () => pool.processFile('__CRASH__')));

    const err = await all.then(
      () => {
        throw new Error('expected Promise.all to reject');
      },
      (e) => e,
    );
    expect(err).toBeInstanceOf(WorkerRequestError);
    expect(err.kind).toBe('worker-crashed');
  });
});
