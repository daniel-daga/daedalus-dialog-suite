// WorldService owns the one zenkit worker that holds the world in memory
// (level-editor.md §7). Unlike MetadataWorkerPool this is a *stateful* worker —
// there is exactly one, it cannot be silently restarted, and a lost worker is a
// lost world. Everything below is about that difference: id routing, what
// happens when the worker dies, and what happens after close.
//
// The worker is injected, so none of this loads the native addon or needs a
// Gothic install.

import { WorldService, type WorldWorker } from '../src/main/services/WorldService';
import { WorkerRequestError } from '../src/main/services/WorkerRequestError';

interface SentMessage { id: string; op: string; payload?: unknown }

class FakeWorker implements WorldWorker {
  sent: SentMessage[] = [];
  terminated = false;
  private handlers = new Map<string, Array<(arg: unknown) => void>>();

  postMessage(message: SentMessage) { this.sent.push(message); }

  on(event: string, handler: (arg: unknown) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  terminate() { this.terminated = true; return Promise.resolve(0); }

  /** Answer a request the service sent, by the op it used. */
  reply(op: string, result: unknown) {
    const message = this.sent.find((m) => m.op === op);
    if (!message) throw new Error(`test asked to reply to ${op}, which was never sent`);
    this.emit('message', { id: message.id, ok: true, result });
  }

  /** The most recent request with this op — undo and redo send `applyOps`
   *  again, so answering the first one every time replies to the wrong call. */
  replyLast(op: string, result: unknown) {
    const message = [...this.sent].reverse().find((m) => m.op === op);
    if (!message) throw new Error(`test asked to reply to ${op}, which was never sent`);
    this.emit('message', { id: message.id, ok: true, result });
  }

  fail(op: string, error: string) {
    const message = [...this.sent].reverse().find((m) => m.op === op)!;
    this.emit('message', { id: message.id, ok: false, error });
  }

  emit(event: string, arg: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(arg);
  }
}

function makeService(timeoutMs?: number) {
  const worker = new FakeWorker();
  const service = new WorldService({
    createWorker: () => worker,
    ...(timeoutMs === undefined ? {} : { requestTimeoutMs: timeoutMs }),
  });
  return { worker, service };
}

/** A service with a world already open — the state every request below needs. */
async function openedService(timeoutMs?: number) {
  const { worker, service } = makeService(timeoutMs);
  const opened = service.openWorld(OPEN);
  worker.reply('open', SUMMARY);
  await opened;
  return { worker, service };
}

const OPEN = {
  worldPath: 'C:/Gothic/NewWorld.zen',
  gameVersion: 'g2' as const,
  assetSources: ['C:/Gothic/Data/Meshes.vdf'],
};

const SUMMARY = {
  worldPath: OPEN.worldPath,
  bbox: [0, 0, 0, 1, 1, 1],
  vobIndex: null,
  stats: {},
  timings: { load: 216, openVfs: 12 },
};

describe('WorldService', () => {
  test('openWorld forwards the request and resolves with the worker summary', async () => {
    const { worker, service } = makeService();
    const pending = service.openWorld(OPEN);

    expect(worker.sent).toHaveLength(1);
    expect(worker.sent[0].op).toBe('open');
    expect(worker.sent[0].payload).toEqual(OPEN);

    worker.reply('open', SUMMARY);
    await expect(pending).resolves.toEqual(SUMMARY);
    service.close();
  });

  test('concurrent requests are routed by id, not by arrival order', async () => {
    // The world mesh takes ~267 ms and a texture takes under one; replying in
    // completion order rather than request order is the normal case, and an
    // implementation that assumes FIFO hands the mesh to the texture caller.
    const { worker, service } = await openedService();

    const mesh = service.getWorldMesh();
    const texture = service.getTexture('NW_WOOD.TGA');

    worker.reply('texture', { name: 'NW_WOOD.TGA', width: 4, height: 4 });
    worker.reply('worldMesh', { groups: [], bbox: [0, 0, 0, 1, 1, 1] });

    await expect(texture).resolves.toEqual({ name: 'NW_WOOD.TGA', width: 4, height: 4 });
    await expect(mesh).resolves.toEqual({ groups: [], bbox: [0, 0, 0, 1, 1, 1] });
    service.close();
  });

  test('a per-request failure rejects only that request', async () => {
    const { worker, service } = await openedService();

    const mesh = service.getWorldMesh();
    const texture = service.getTexture('MISSING.TGA');
    worker.fail('texture', 'no such texture');
    worker.reply('worldMesh', { groups: [], bbox: [] });

    await expect(texture).rejects.toThrow('no such texture');
    await expect(mesh).resolves.toEqual({ groups: [], bbox: [] });
    service.close();
  });

  test('a dead worker rejects every request in flight', async () => {
    // A stateful worker cannot be restarted behind the caller's back: the world
    // it held is gone, and quietly re-loading it would drop any pending edit.
    const { worker, service } = await openedService();

    const mesh = service.getWorldMesh();
    const visuals = service.getInstancedVisuals();
    worker.emit('error', new Error('addon segfaulted'));

    await expect(mesh).rejects.toThrow(WorkerRequestError);
    await expect(visuals).rejects.toThrow(WorkerRequestError);
    service.close();
  });

  test('a request after the worker died reports the crash, not a hang', async () => {
    const { worker, service } = await openedService();
    worker.emit('error', new Error('addon segfaulted'));

    await expect(service.getWorldMesh()).rejects.toThrow(WorkerRequestError);
    service.close();
  });

  test('a request that outlives its timeout rejects and does not resolve later', async () => {
    jest.useFakeTimers();
    try {
      const { worker, service } = await openedService(50);

      const mesh = service.getWorldMesh();
      const settled = jest.fn();
      mesh.then(settled, settled);

      jest.advanceTimersByTime(51);
      await expect(mesh).rejects.toThrow(WorkerRequestError);

      // A late reply must not resurrect a request the caller was already told
      // had failed.
      expect(() => worker.reply('worldMesh', { groups: [], bbox: [] })).not.toThrow();
      service.close();
    } finally {
      jest.useRealTimers();
    }
  });

  test('close terminates the worker and rejects what is still waiting', async () => {
    const { worker, service } = await openedService();

    const mesh = service.getWorldMesh();
    service.close();

    await expect(mesh).rejects.toThrow(WorkerRequestError);
    expect(worker.terminated).toBe(true);
    await expect(service.getWorldMesh()).rejects.toThrow(WorkerRequestError);
  });

  test('asking for geometry before a world is open is refused, not queued', async () => {
    // Otherwise the request sits in the worker's queue until some later
    // openWorld makes it answerable — with the wrong world.
    const { service } = makeService();
    await expect(service.getWorldMesh()).rejects.toThrow(/no world is open/i);
    service.close();
  });

  test('the worker is not started until a world is actually opened', () => {
    // The World surface is lazily loaded (§6) and zenkit-node loads only when a
    // world project opens; spawning the worker in the constructor would pull
    // the native addon into every session, including dialog-only ones.
    let created = 0;
    const service = new WorldService({ createWorker: () => { created++; return new FakeWorker(); } });
    expect(created).toBe(0);
    // close() below rejects this, which is the point of the test — catch it so
    // the rejection is handled rather than crashing the runner.
    service.openWorld(OPEN).catch(() => undefined);
    expect(created).toBe(1);
    service.close();
  });
});

// The op log (level-editor.md §7: "WorldService — authoritative op log"). The
// history lives here rather than in the renderer for the same reason the world
// does: the renderer holds a projection, and an undo stack over a projection
// can outlive the thing it describes.
describe('the op log', () => {
  const move = (vob: number, path: string, from: Move['from'], to: Move['to']): Move =>
    ({ op: 'MoveVob', vob, path, from, to });
  type Move = {
    op: 'MoveVob'; vob: number; path: string;
    from: [number, number, number]; to: [number, number, number];
  };

  const A = move(1, '0/4', [0, 0, 0], [10, 0, 0]);
  const B = move(2, '0/5', [0, 0, 0], [20, 0, 0]);

  /** Apply a batch and let the worker confirm it. */
  async function applied(service: WorldService, worker: FakeWorker, ops: Move[]) {
    const pending = service.applyOps(ops);
    worker.replyLast('applyOps', null);
    await pending;
  }

  test('an edit goes to the worker as ops', async () => {
    const { worker, service } = await openedService();

    await applied(service, worker, [A, B]);

    expect(worker.sent.filter((m) => m.op === 'applyOps')).toHaveLength(1);
    expect(worker.sent.at(-1)!.payload).toEqual({ ops: [A, B] });
    service.close();
  });

  test('undo replays the inverses, in reverse order, through the same path', async () => {
    // Reverse order is not decoration: two ops on the *same* VOB in one batch
    // compose, and undoing them front-to-back leaves it where the first op put
    // it. §7 says undo/redo replay inverse ops through the same path, so what
    // reaches the worker is an ordinary applyOps and nothing special.
    const { worker, service } = await openedService();
    await applied(service, worker, [A, B]);

    const undone = service.undo();
    worker.replyLast('applyOps', null);
    await expect(undone).resolves.toBe(true);

    expect(worker.sent.at(-1)!.op).toBe('applyOps');
    expect(worker.sent.at(-1)!.payload).toEqual({
      ops: [
        { ...B, from: B.to, to: B.from },
        { ...A, from: A.to, to: A.from },
      ],
    });
    service.close();
  });

  test('redo sends the batch again, as it was', async () => {
    const { worker, service } = await openedService();
    await applied(service, worker, [A]);

    const undone = service.undo();
    worker.replyLast('applyOps', null);
    await undone;

    const redone = service.redo();
    worker.replyLast('applyOps', null);
    await expect(redone).resolves.toBe(true);

    expect(worker.sent.at(-1)!.payload).toEqual({ ops: [A] });
    service.close();
  });

  test('there is nothing to undo or redo on a freshly opened world', async () => {
    const { worker, service } = await openedService();
    const before = worker.sent.length;

    await expect(service.undo()).resolves.toBe(false);
    await expect(service.redo()).resolves.toBe(false);

    expect(worker.sent).toHaveLength(before);
    service.close();
  });

  test('a new edit drops the redo stack', async () => {
    const { worker, service } = await openedService();
    await applied(service, worker, [A]);
    const undone = service.undo();
    worker.replyLast('applyOps', null);
    await undone;

    await applied(service, worker, [B]);

    // Redoing A now would move a VOB the user never touched again.
    await expect(service.redo()).resolves.toBe(false);
    service.close();
  });

  test('opening a world starts an empty log — an op belongs to the world it was made against', async () => {
    // The paths in an op address one world's VOB tree. Replayed against the
    // next world they resolve to whatever happens to sit at that path.
    const { worker, service } = await openedService();
    await applied(service, worker, [A]);

    const reopened = service.openWorld({ ...OPEN, worldPath: 'C:/Gothic/OldWorld.zen' });
    worker.replyLast('open', SUMMARY);
    await reopened;

    await expect(service.undo()).resolves.toBe(false);
    expect(worker.sent.filter((m) => m.op === 'applyOps')).toHaveLength(1);
    service.close();
  });

  test('an edit the worker refused is not in the log', async () => {
    // Otherwise undo sends the inverse of something that never happened, which
    // moves a VOB that was never moved.
    const { worker, service } = await openedService();

    const failing = service.applyOps([A]);
    worker.fail('applyOps', 'no vob at indexPath');
    await expect(failing).rejects.toThrow('no vob at indexPath');

    await expect(service.undo()).resolves.toBe(false);
    service.close();
  });

  test('a refused undo leaves the batch where it was, still undoable', async () => {
    // The stacks move only once the worker has confirmed the replay. If they
    // moved first, a refused undo would leave the history one step ahead of
    // the world — the batch gone from the undo stack while still applied, and
    // sitting on the redo stack ready to be applied a second time.
    const { worker, service } = await openedService();
    await applied(service, worker, [A]);

    const refused = service.undo();
    worker.fail('applyOps', 'no vob at indexPath');
    await expect(refused).rejects.toThrow('no vob at indexPath');

    const retried = service.undo();
    worker.replyLast('applyOps', null);
    await expect(retried).resolves.toBe(true);
    // ...and it did not also land on the redo stack the first time round.
    const redone = service.redo();
    worker.replyLast('applyOps', null);
    await expect(redone).resolves.toBe(true);
    await expect(service.redo()).resolves.toBe(false);
    service.close();
  });

  test('editing before a world is open is refused, not queued', async () => {
    const { service } = makeService();
    await expect(service.applyOps([A])).rejects.toThrow(/no world is open/i);
    service.close();
  });
});
