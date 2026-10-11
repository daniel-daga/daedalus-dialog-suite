/**
 * The window-close guard is per window, not per process.
 *
 * Approving a close used to set a module-global flag that nothing reset, so
 * the next window created — on macOS, an `activate` after the last window
 * closed — found the guard already satisfied and closed without ever asking
 * the renderer about unsaved work (2026-07 4.12).
 *
 * @jest-environment node
 */

import { describe, it, expect, jest } from '@jest/globals';
import { EventEmitter } from 'events';
import * as os from 'os';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

jest.mock('electron', () => {
  const { EventEmitter: EE } = jest.requireActual<typeof import('events')>('events');
  const created: unknown[] = [];
  class FakeWebContents extends EE {
    send = jest.fn();
    setWindowOpenHandler = jest.fn();
    getURL = () => 'file:///index.html';
  }
  class FakeBrowserWindow extends EE {
    webContents = new FakeWebContents();
    destroy = jest.fn();
    loadURL = jest.fn();
    loadFile = jest.fn();
    close = jest.fn();
    constructor() {
      super();
      created.push(this);
    }
    static getAllWindows = () => created;
  }
  return {
    __created: created,
    __listeners: new Map<string, Handler>(),
    app: {
      getPath: () => os.tmpdir(),
      getVersion: () => '0.0.0-test',
      setPath: () => undefined,
      whenReady: () => new Promise(() => undefined),
      on: () => undefined,
      quit: () => undefined,
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      handle: () => undefined,
      on(channel: string, handler: Handler) {
        (jest.requireMock('electron') as { __listeners: Map<string, Handler> }).__listeners.set(
          channel,
          handler
        );
      },
    },
    dialog: {},
    shell: {},
  };
});

const electronMock = jest.requireMock('electron') as {
  __created: EventEmitter[];
  __listeners: Map<string, Handler>;
};

/** Emits `close` with a real-enough event and reports whether it was vetoed. */
function emitClose(win: EventEmitter): boolean {
  let prevented = false;
  win.emit('close', { preventDefault: () => { prevented = true; } });
  return prevented;
}

describe('window close guard', () => {
  it('re-arms the guard for a window created after an approved close', async () => {
    const { createWindow, setupIpcHandlers } = await import('../src/main/main');
    setupIpcHandlers();
    const approveClose = electronMock.__listeners.get('app:approveClose');
    expect(approveClose).toBeDefined();

    createWindow();
    const first = electronMock.__created[0];
    expect(emitClose(first)).toBe(true);

    // The renderer approves: the guard steps aside for this window only.
    approveClose!(undefined);
    expect(emitClose(first)).toBe(false);
    first.emit('closed');

    createWindow();
    const second = electronMock.__created[1];
    expect(second).not.toBe(first);
    expect(emitClose(second)).toBe(true);
  });
});
