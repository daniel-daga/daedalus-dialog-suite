/**
 * Importing `main.ts` must not spawn a worker thread.
 *
 * `WorldService` has always been lazy this way — constructed eagerly, but its
 * worker (and the native addon behind it) only starts when a world is opened.
 * `ParserService` was not: its constructor spawned an 8-worker pool at module
 * load, so any test that imports `main.ts` inherited eight live threads and the
 * "A worker process has failed to exit gracefully" warning that comes with them.
 *
 * The assertion is on the real thing — `worker_threads.Worker` constructions —
 * not on a proxy for it.
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as os from 'os';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

jest.mock('worker_threads', () => {
  const actual = jest.requireActual<typeof import('worker_threads')>('worker_threads');
  const { EventEmitter: EE } = jest.requireActual<typeof import('events')>('events');
  const constructed: string[] = [];
  class FakeWorker extends EE {
    constructor(scriptPath: string) {
      super();
      constructed.push(String(scriptPath));
    }
    postMessage() {
      /* the pool never gets an answer here; no test below awaits one */
    }
    terminate() {
      return Promise.resolve(0);
    }
  }
  return { ...actual, Worker: FakeWorker, __constructed: constructed };
});

jest.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    setPath: () => undefined,
    // Never resolves: keeps createWindow and the real startup path from running
    // on import, exactly as worldOpenDialogDefaultPath.test.ts does.
    whenReady: () => new Promise(() => undefined),
    on: () => undefined,
    quit: () => undefined,
  },
  BrowserWindow: class {},
  ipcMain: { handle: (_c: string, _h: Handler) => undefined, on: () => undefined },
  dialog: {},
  shell: {},
}));

const workerThreads = jest.requireMock('worker_threads') as { __constructed: string[] };

describe('main.ts startup cost', () => {
  beforeEach(() => {
    workerThreads.__constructed.length = 0;
  });

  it('constructs no worker thread at import time', async () => {
    await import('../src/main/main');

    expect(workerThreads.__constructed).toEqual([]);
  });

  it('still spawns the parser pool on the first parse', async () => {
    const { ParserService } = await import('../src/main/services/ParserService');

    const service = new ParserService({ workerCount: 2, workerPath: '/fake/parser.worker.js' });
    expect(workerThreads.__constructed).toEqual([]);

    // Deliberately not awaited: the fake worker never answers. The point is
    // that asking for a parse is what brings the pool up.
    void service.parseSource('func void x() {};');
    expect(workerThreads.__constructed).toEqual(['/fake/parser.worker.js', '/fake/parser.worker.js']);

    service.dispose();
  });
});
