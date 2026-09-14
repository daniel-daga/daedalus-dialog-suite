/**
 * ParserService worker-lifecycle tests (D1).
 *
 * Uses stub worker scripts (tests/fixtures/workers) injected via the workerPath
 * option so worker crash / hang / restart behaviour is deterministic.
 *
 * @jest-environment node
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { describeExit } from '../../src/main/services/ForkedWorker';
import { ParserService } from '../../src/main/services/ParserService';
import { WorkerRequestError } from '../../src/main/services/WorkerRequestError';

const FIXTURE_DIR = path.join(__dirname, '../fixtures/workers');
const workerFixture = (name: string) => path.join(FIXTURE_DIR, name);

describe('ParserService worker lifecycle', () => {
  const services: ParserService[] = [];

  function makeService(fixture: string, overrides: Record<string, unknown> = {}): ParserService {
    const svc = new ParserService({
      workerPath: workerFixture(fixture),
      workerCount: 2,
      // Comfortably large so a real crash event wins the race against the
      // timeout backstop under load; the hang test overrides this.
      timeoutMs: 5000,
      ...overrides,
    });
    services.push(svc);
    return svc;
  }

  afterEach(async () => {
    while (services.length) {
      await services.pop()!.dispose();
    }
  });

  // A worker process that is still alive keeps its IPC pipe open in the parent,
  // and that handle keeps the whole Jest worker *process* from exiting. Jest
  // force-kills it after 500 ms and prints "A worker process has failed to exit
  // gracefully". `dispose()` therefore has to be awaitable: firing
  // `worker.terminate()` and returning leaves the child running past the end of
  // the test file. `kill(pid, 0)` is how that is observed from outside — and it
  // is not fooled by a zombie, because the exit event `terminate()` waits on is
  // the same one that reaps the child.
  const workerPids = (pool: unknown): number[] =>
    (pool as { workers: Array<{ child: { pid: number } }> }).workers.map((w) => w.child.pid);
  const isAlive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('dispose() resolves only once every worker process has exited', async () => {
    const svc = makeService('echo.worker.js');
    await svc.parseSource('warm-the-pool');

    // Guard against a vacuous pass: the pool must really be running children.
    const pids = workerPids(svc);
    expect(pids).toHaveLength(2);
    expect(pids.every(isAlive)).toBe(true);

    await svc.dispose();

    expect(pids.filter(isAlive)).toEqual([]);
  });

  it('rejects with a timeout error when the worker never responds', async () => {
    const svc = makeService('hang.worker.js', { timeoutMs: 150 });

    const err = await svc.parseSource('anything').then(
      () => {
        throw new Error('expected parseSource to reject');
      },
      (e) => e,
    );

    expect(err).toBeInstanceOf(WorkerRequestError);
    expect(err.kind).toBe('timeout');
  });

  it('rejects the in-flight request with worker-crashed and keeps other workers usable (exit)', async () => {
    const svc = makeService('exit.worker.js');

    const crashErr = await svc.parseSource('__CRASH__').then(
      () => {
        throw new Error('expected crash request to reject');
      },
      (e) => e,
    );
    expect(crashErr).toBeInstanceOf(WorkerRequestError);
    expect(crashErr.kind).toBe('worker-crashed');

    // A subsequent normal request must resolve on a live worker.
    await expect(svc.parseSource('normal')).resolves.toBeDefined();
  });

  it('settles the pending request when the worker exits cleanly (code 0)', async () => {
    // A 30 s timeout is the production value: if a clean exit is not reaped,
    // this request only settles when that backstop fires, so the test times
    // out rather than passing slowly.
    const svc = makeService('exit.worker.js', { timeoutMs: 30000 });

    const err = await svc.parseSource('__EXIT0__').then(
      () => {
        throw new Error('expected the request on the exited worker to reject');
      },
      (e) => e,
    );
    expect(err).toBeInstanceOf(WorkerRequestError);
    expect(err.kind).toBe('worker-crashed');

    // The lane is restored: a subsequent request still resolves.
    await expect(svc.parseSource('normal')).resolves.toBeDefined();
  });

  it('rejects the in-flight request with worker-crashed (throw / error event)', async () => {
    const svc = makeService('throw.worker.js');

    const crashErr = await svc.parseSource('__CRASH__').then(
      () => {
        throw new Error('expected crash request to reject');
      },
      (e) => e,
    );
    expect(crashErr).toBeInstanceOf(WorkerRequestError);
    expect(crashErr.kind).toBe('worker-crashed');

    await expect(svc.parseSource('normal')).resolves.toBeDefined();
  });

  // The regression this pins is the whole point of #268: with the pools on
  // `worker_threads` the fixture's fatal signal killed the Jest runner itself,
  // so this file did not fail — it segfaulted.
  it('survives a hard native crash in a worker', async () => {
    const svc = makeService('abort.worker.js');
    // Warm both lanes so the crash lands on a worker the pool is tracking.
    await svc.parseSource('warm-the-pool');

    const err = await svc.parseSource('__ABORT__').then(
      () => {
        throw new Error('expected parseSource to reject');
      },
      (e) => e as WorkerRequestError,
    );
    expect(err).toBeInstanceOf(WorkerRequestError);
    expect(err.kind).toBe('worker-crashed');

    // The pool replaced the dead worker — and this process is still alive to ask.
    await expect(svc.parseSource('still-here')).resolves.toBeDefined();
  });

  it('recovers after a crash: all subsequent requests settle', async () => {
    const marker = path.join(
      os.tmpdir(),
      `parser-crash-once-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.CRASH_ONCE_MARKER = marker;
    try {
      const svc = makeService('crash-once.worker.js');

      // First request crashes its worker once.
      await svc.parseSource('first').catch(() => undefined);

      // 2 x workerCount subsequent requests must all settle (dead worker left
      // rotation, replacement works).
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => svc.parseSource('ok')),
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    } finally {
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
      delete process.env.CRASH_ONCE_MARKER;
    }
  });

  it('dispatches to an idle worker instead of queueing behind a busy one', async () => {
    const svc = makeService('block.worker.js', { timeoutMs: 1000 });

    // Occupy one worker with a slow job that blocks that child until well past
    // the timeout; it eventually settles as a timeout rejection.
    const slow = svc.parseSource('__SLOW__').then(
      () => {
        throw new Error('expected the slow request to reject');
      },
      (e) => e,
    );

    // With idle-worker dispatch all of these drain through the free worker.
    // Round-robin would send one of them to the blocked worker, where it
    // times out instead of resolving.
    const fast = await Promise.all(Array.from({ length: 3 }, () => svc.parseSource('fast')));
    expect(fast).toHaveLength(3);

    // Settle the slow request before teardown.
    const slowErr = await slow;
    expect(slowErr).toBeInstanceOf(WorkerRequestError);
    expect(slowErr.kind).toBe('timeout');
  });

  it('drains a queue longer than the pool', async () => {
    const svc = makeService('echo.worker.js');

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => svc.parseSource(`source-${i}`)),
    );
    expect(results).toHaveLength(10);
  });

  it('enters a degraded state after the restart cap and rejects immediately', async () => {
    const svc = makeService('exit.worker.js');

    // Each crash retires one worker; the cap is 5 within the window, so the
    // 6th retire trips the degraded state.
    for (let i = 0; i < 6; i++) {
      await svc.parseSource('__CRASH__').catch(() => undefined);
    }

    const err = await svc.parseSource('__CRASH__').then(
      () => {
        throw new Error('expected degraded rejection');
      },
      (e) => e,
    );
    expect(err).toBeInstanceOf(WorkerRequestError);
    expect(err.message).toMatch(/crash-looping/);
  });
});

describe('describeExit', () => {
  // What the user is told when a worker dies. A native crash reaches them only
  // through this string, so the signal has to be in it.
  it('names the signal when one killed the worker, and the code otherwise', () => {
    expect(describeExit(null, 'SIGSEGV')).toBe('killed by SIGSEGV');
    expect(describeExit(1, null)).toBe('exit code 1');
    expect(describeExit(0, null)).toBe('exit code 0');
  });
});
