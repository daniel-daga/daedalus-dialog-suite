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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ForkedWorker } from '../src/main/services/ForkedWorker';
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

// Closing a world used to SIGKILL the child in the middle of a native save
// (#566): as a thread, `terminate()` could not interrupt the synchronous call
// and the write finished; as a process it was lost, with a stray `.tmp`.
describe('WorldService closing over a save that is being written', () => {
  const slowSavePath = path.join(__dirname, 'fixtures', 'workers', 'world-slow-save.worker.js');
  let dir: string;
  let service: WorldService;
  let exits: Promise<NodeJS.Signals | null>[];

  const makeService = (requestTimeoutMs: number) => new WorldService({
    requestTimeoutMs,
    createWorker: () => {
      const worker = new ForkedWorker(slowSavePath, { maxOldSpaceMb: null });
      exits.push(new Promise((resolve) => { worker.on('exit', (_code, signal) => resolve(signal)); }));
      return worker;
    },
  });

  /** Long enough for the save to be posted (edits are serialized, so it is
   *  sent a microtask later) and for the worker to be inside the write. */
  const midSave = () => new Promise((resolve) => { setTimeout(resolve, 100); });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-close-save-'));
    exits = [];
  });
  afterEach(async () => {
    service.close();
    await Promise.all(exits);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lets the save finish and answers its caller, then ends the worker', async () => {
    service = makeService(10_000);
    await service.openWorld(request('C:/NEWWORLD.ZEN'));
    const target = path.join(dir, 'world.zen');

    const saved = service.saveWorld(target);
    await midSave();
    // Posted behind the save, so the worker has not started it.
    const queued = service.getWorldMesh();
    service.close();

    await expect(queued).rejects.toMatchObject({ kind: 'world-closed' });
    await expect(saved).resolves.toBeUndefined();
    expect(fs.readFileSync(target, 'utf8')).toBe('saved');
    // The world is closed all the same, and the child does not linger.
    expect(() => service.openWorldPath()).toThrow('No world is open');
    await expect(exits[0]).resolves.toBe('SIGKILL');
  });

  it('lets the save finish when another world is opened behind it', async () => {
    service = makeService(10_000);
    await service.openWorld(request('C:/NEWWORLD.ZEN'));
    const target = path.join(dir, 'world.zen');

    const saved = service.saveWorld(target);
    await midSave();
    const reopened = service.openWorld(request('C:/OLDWORLD.ZEN'));

    await expect(saved).resolves.toBeUndefined();
    await expect(reopened).resolves.toEqual({ worldPath: 'C:/OLDWORLD.ZEN' });
    expect(fs.readFileSync(target, 'utf8')).toBe('saved');
  });

  it('serves a world reopened while the closed one is still saving', async () => {
    service = makeService(10_000);
    await service.openWorld(request('C:/NEWWORLD.ZEN'));
    const target = path.join(dir, 'world.zen');

    const saved = service.saveWorld(target);
    await midSave();
    service.close();
    await expect(service.openWorld(request('C:/OLDWORLD.ZEN'))).resolves.toEqual({ worldPath: 'C:/OLDWORLD.ZEN' });

    await expect(saved).resolves.toBeUndefined();
    await exits[0];
    // The first worker's end is not the second one's death.
    await expect(service.getWorldMesh()).resolves.toBeDefined();
  });

  it('still kills a wedged save once its timeout runs out', async () => {
    service = makeService(600);
    await service.openWorld(request('C:/NEWWORLD.ZEN'));
    const target = path.join(dir, 'wedge.zen');

    const saved = service.saveWorld(target);
    await midSave();
    service.close();

    await expect(saved).rejects.toMatchObject({ kind: 'world-timeout' });
    await expect(exits[0]).resolves.toBe('SIGKILL');
    expect(fs.existsSync(target)).toBe(false);
  });
});
