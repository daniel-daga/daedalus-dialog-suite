/**
 * Importing `main.ts` must not spawn a worker process.
 *
 * `WorldService` has always been lazy this way — constructed eagerly, but its
 * worker (and the native addon behind it) only starts when a world is opened.
 * `ParserService` was not: its constructor spawned an 8-worker pool at module
 * load, so any test that imports `main.ts` inherited eight live workers and the
 * "A worker process has failed to exit gracefully" warning that comes with them.
 *
 * The assertion is on the real thing — `child_process.fork` calls — not on a
 * proxy for it.
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as os from 'os';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

jest.mock('child_process', () => {
  const actual = jest.requireActual<typeof import('child_process')>('child_process');
  const { EventEmitter: EE } = jest.requireActual<typeof import('events')>('events');
  const forked: string[] = [];
  class FakeChild extends EE {
    send() {
      /* the pool never gets an answer here; no test below awaits one */
    }
    kill() {
      this.emit('exit', 0, null);
      return true;
    }
  }
  return {
    ...actual,
    fork: (scriptPath: string) => {
      forked.push(String(scriptPath));
      return new FakeChild();
    },
    __forked: forked,
  };
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

const childProcess = jest.requireMock('child_process') as { __forked: string[] };

describe('main.ts startup cost', () => {
  beforeEach(() => {
    childProcess.__forked.length = 0;
  });

  it('forks no worker process at import time', async () => {
    await import('../src/main/main');

    expect(childProcess.__forked).toEqual([]);
  });

  it('still spawns the parser pool on the first parse', async () => {
    const { ParserService } = await import('../src/main/services/ParserService');

    const service = new ParserService({ workerCount: 2, workerPath: '/fake/parser.worker.js' });
    expect(childProcess.__forked).toEqual([]);

    // Deliberately not awaited: the fake worker never answers. The point is
    // that asking for a parse is what brings the pool up.
    void service.parseSource('func void x() {};');
    expect(childProcess.__forked).toEqual(['/fake/parser.worker.js', '/fake/parser.worker.js']);

    await service.dispose();
  });
});
