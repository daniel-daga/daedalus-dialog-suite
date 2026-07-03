/**
 * ParserService worker-lifecycle tests (D1).
 *
 * Uses stub worker scripts (tests/fixtures/workers) injected via the workerPath
 * option so worker crash / hang / restart behaviour is deterministic.
 *
 * @jest-environment node
 */

import * as path from 'path';
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

  afterEach(() => {
    while (services.length) {
      const svc = services.pop();
      (svc as unknown as { dispose?: () => void }).dispose?.();
    }
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

  it('recovers after a crash: all subsequent requests settle', async () => {
    const marker = path.join(
      require('os').tmpdir(),
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
      const fs = require('fs');
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
      delete process.env.CRASH_ONCE_MARKER;
    }
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
