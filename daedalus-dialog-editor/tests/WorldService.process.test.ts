/**
 * WorldService's worker is a forked child process, not a thread (#543).
 *
 * ZenKit is native code reading `.zen`, mesh and texture files the threat model
 * calls hostile. A segfault in a `worker_threads` thread ends the process it
 * lives in — the Electron main process, with every unsaved script edit in the
 * renderer — and fires no `exit`. This drives the service's *default* worker
 * factory against a stub worker that really dies of a fatal signal: under a
 * thread it would kill this Jest runner instead of failing a test.
 *
 * @jest-environment node
 */
import * as path from 'path';
import { WorldService } from '../src/main/services/WorldService';
import { WorkerRequestError } from '../src/main/services/WorkerRequestError';

const workerPath = path.join(__dirname, 'fixtures', 'workers', 'world-crash.worker.js');
const request = (worldPath: string) => ({ worldPath, gameVersion: 'g2', assetSources: [] }) as never;

describe('WorldService process boundary', () => {
  let service: WorldService;
  beforeEach(() => { service = new WorldService({ workerPath, requestTimeoutMs: 10_000 }); });
  afterEach(() => service.close());

  it('survives a native crash in the world worker, and says where it died', async () => {
    const error = await service.openWorld(request('crash')).then(
      () => { throw new Error('expected openWorld to reject'); },
      (e: unknown) => e as WorkerRequestError,
    );

    expect(error).toBeInstanceOf(WorkerRequestError);
    expect(error.kind).toBe('world-crashed');
    // The phase the worker reported before the native call is what makes the
    // report useful; the signal is what says it was a crash, not an exit.
    expect(error.message).toContain('during open for "crash" at loadWorld');
    expect(error.message).toContain(process.platform === 'win32' ? 'killed by SIGKILL' : 'killed by SIGSEGV');

    // This process is still here to ask, and "reopen the world" works.
    await expect(service.openWorld(request('C:/NEWWORLD.ZEN'))).resolves.toEqual({ worldPath: 'C:/NEWWORLD.ZEN' });
  });

  it('carries the geometry across the fork as real buffers', async () => {
    await service.openWorld(request('C:/NEWWORLD.ZEN'));
    const mesh = await service.getWorldMesh() as unknown as { groups: { positions: ArrayBuffer }[] };
    expect(mesh.groups[0].positions).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Float32Array(mesh.groups[0].positions))).toEqual([1, 2, 3]);
  });
});
