/**
 * Unit tests for FileWatcherService
 *
 * Tests the main-process file watcher that monitors project directories for
 * external .d file changes and forwards events to the renderer window.
 *
 * @jest-environment node
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock chokidar before importing the service under test
// ---------------------------------------------------------------------------

type EventHandler = (filePath: string) => void;
type ErrorHandler = (error: unknown) => void;

interface MockWatcher {
  on: (event: string, handler: EventHandler | ErrorHandler) => MockWatcher;
  close: () => Promise<void>;
  // Internal helpers for test assertions
  _handlers: Map<string, EventHandler | ErrorHandler>;
  _emit: (event: string, filePath: string) => void;
  _closed: boolean;
}

let mockWatcher: MockWatcher;

jest.mock('chokidar', () => ({
  watch: jest.fn((_path: string, _opts: unknown) => {
    mockWatcher = {
      _handlers: new Map(),
      _closed: false,
      on(event: string, handler: EventHandler | ErrorHandler) {
        this._handlers.set(event, handler);
        return this;
      },
      close() {
        this._closed = true;
        return Promise.resolve();
      },
      _emit(event: string, filePath: string) {
        const handler = this._handlers.get(event) as EventHandler | undefined;
        if (handler) handler(filePath);
      },
    };
    return mockWatcher;
  }),
}));

// ---------------------------------------------------------------------------
// Import service after mocking
// ---------------------------------------------------------------------------

import { FileWatcherService } from '../src/main/services/FileWatcherService';
import * as chokidar from 'chokidar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockWindow(destroyed = false) {
  const sentEvents: Array<[string, unknown]> = [];
  return {
    isDestroyed: () => destroyed,
    webContents: {
      send: jest.fn((channel: string, event: unknown) => {
        sentEvents.push([channel, event]);
      }),
    },
    _sentEvents: sentEvents,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileWatcherService', () => {
  let service: FileWatcherService;

  beforeEach(() => {
    service = new FileWatcherService();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await service.stopWatching();
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('returns null for watched path before any watch is started', () => {
      expect(service.getWatchedPath()).toBeNull();
    });

    it('returns the project path after startWatching', async () => {
      await service.startWatching('/project/dialogs');
      expect(service.getWatchedPath()).toBe('/project/dialogs');
    });

    it('returns null after stopWatching', async () => {
      await service.startWatching('/project/dialogs');
      await service.stopWatching();
      expect(service.getWatchedPath()).toBeNull();
    });

    it('closes the previous watcher when startWatching is called again', async () => {
      await service.startWatching('/project/dialogs');
      const firstWatcher = mockWatcher;

      await service.startWatching('/project/other');

      expect(firstWatcher._closed).toBe(true);
      expect(service.getWatchedPath()).toBe('/project/other');
    });

    it('stopWatching is a no-op when no watcher is active', async () => {
      // Should not throw
      await expect(service.stopWatching()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Event forwarding
  // -------------------------------------------------------------------------

  describe('event forwarding', () => {
    it('forwards a change event to the renderer window', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching('/project');

      mockWatcher._emit('change', '/project/DIA_Test.d');

      expect(win.webContents.send).toHaveBeenCalledWith('fileWatcher:changed', {
        type: 'change',
        filePath: '/project/DIA_Test.d',
      });
    });

    it('forwards an add event to the renderer window', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching('/project');

      mockWatcher._emit('add', '/project/DIA_New.d');

      expect(win.webContents.send).toHaveBeenCalledWith('fileWatcher:changed', {
        type: 'add',
        filePath: '/project/DIA_New.d',
      });
    });

    it('forwards an unlink event to the renderer window', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching('/project');

      mockWatcher._emit('unlink', '/project/DIA_Old.d');

      expect(win.webContents.send).toHaveBeenCalledWith('fileWatcher:changed', {
        type: 'unlink',
        filePath: '/project/DIA_Old.d',
      });
    });

    it('does not forward events when no window is set', async () => {
      // No setWindow call — events should be silently dropped
      await service.startWatching('/project');
      // Should not throw
      expect(() => mockWatcher._emit('change', '/project/DIA_Test.d')).not.toThrow();
    });

    it('does not forward events when the window has been destroyed', async () => {
      const win = makeMockWindow(/* destroyed= */ true);
      service.setWindow(win as any);
      await service.startWatching('/project');

      mockWatcher._emit('change', '/project/DIA_Test.d');

      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Ignore predicate
  // -------------------------------------------------------------------------

  describe('ignored predicate', () => {
    const getIgnored = async (projectPath: string) => {
      await service.startWatching(projectPath);
      const opts = (chokidar.watch as jest.Mock).mock.calls.at(-1)![1] as {
        ignored: (p: string, stats?: { isFile(): boolean; isDirectory(): boolean }) => boolean;
      };
      return opts.ignored;
    };

    const fileStats = { isFile: () => true, isDirectory: () => false };
    const dirStats = { isFile: () => false, isDirectory: () => true };

    it('ignores non-.d files', async () => {
      const ignored = await getIgnored('/project');
      expect(ignored('/project/readme.txt', fileStats)).toBe(true);
    });

    it('does not ignore .d files', async () => {
      const ignored = await getIgnored('/project');
      expect(ignored('/project/DIA_Test.d', fileStats)).toBe(false);
    });

    it('never ignores directories, even with a dot in the name', async () => {
      const ignored = await getIgnored('/project');
      // A directory like "Mod.bak/" must be traversed so its .d files are seen
      expect(ignored('/project/Mod.bak', dirStats)).toBe(false);
    });

    it('does not ignore a dotted directory on Windows-style backslash paths', async () => {
      const ignored = await getIgnored('C:\\project');
      // Without stats we cannot tell a dotted directory from a file, so the
      // path must be traversed rather than wrongly skipped
      expect(ignored('C:\\project\\Mod.bak', undefined)).toBe(false);
    });

    it('ignores the editor atomic-write temp files (they never end in .d)', async () => {
      const ignored = await getIgnored('/project');
      // E5 temp file: `.<basename>.<pid>.<rand>.tmp` — must produce no events.
      expect(ignored('/project/.DIA_Test.d.12345.ab3d9.tmp', fileStats)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // External-change callback (cache invalidation hook)
  // -------------------------------------------------------------------------

  describe('setOnExternalChange', () => {
    it('invokes the callback for a genuine external change event', async () => {
      const cb = jest.fn();
      service.setOnExternalChange(cb);
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching('/project');

      mockWatcher._emit('change', '/project/DIA_Test.d');

      expect(cb).toHaveBeenCalledWith('/project/DIA_Test.d', 'change');
    });

    it('does not invoke the callback for a self-suppressed write', async () => {
      const cb = jest.fn();
      service.setOnExternalChange(cb);
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching('/project');

      service.notifySelfWrite('/project/DIA_Test.d');
      mockWatcher._emit('change', '/project/DIA_Test.d');

      expect(cb).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Self-write suppression
  // -------------------------------------------------------------------------

  describe('notifySelfWrite', () => {
    it('suppresses the next change event for the notified path', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching('/project');

      service.notifySelfWrite('/project/DIA_Test.d');
      mockWatcher._emit('change', '/project/DIA_Test.d');

      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('suppresses only the first event — subsequent events come through', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching('/project');

      service.notifySelfWrite('/project/DIA_Test.d');
      mockWatcher._emit('change', '/project/DIA_Test.d'); // suppressed
      mockWatcher._emit('change', '/project/DIA_Test.d'); // should fire

      expect(win.webContents.send).toHaveBeenCalledTimes(1);
    });

    it('only suppresses the notified path, not other paths', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching('/project');

      service.notifySelfWrite('/project/DIA_Test.d');
      mockWatcher._emit('change', '/project/DIA_Other.d'); // different file → should fire

      expect(win.webContents.send).toHaveBeenCalledWith('fileWatcher:changed', {
        type: 'change',
        filePath: '/project/DIA_Other.d',
      });
    });

    it('suppresses self-writes regardless of path separator', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching('/project');

      // The notifier may use backslashes while the watcher reports forward
      // slashes (common on Windows) — suppression must still match.
      service.notifySelfWrite('C:\\Project\\DIA_Test.d');
      mockWatcher._emit('change', 'C:/Project/DIA_Test.d');

      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('does not keep the event loop alive for the two-second expiry', async () => {
      // The expiry timer outlives the call by two seconds. Left referenced it
      // keeps its whole process alive — in production the Electron main
      // process, and under Jest the worker process, which is force-killed
      // after 500 ms with "A worker process has failed to exit gracefully".
      // `getActiveResourcesInfo()` lists only resources that keep the loop
      // alive, so an unref'd timer does not appear here.
      const loopKeepingTimers = () =>
        process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

      const before = loopKeepingTimers();
      service.notifySelfWrite('/project/DIA_Test.d');

      expect(loopKeepingTimers()).toBe(before);
    });

    it('stopWatching clears the self-written paths set', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching('/project');

      service.notifySelfWrite('/project/DIA_Test.d');
      await service.stopWatching();

      // Restart and emit — the notified path should no longer be suppressed
      await service.startWatching('/project');
      mockWatcher._emit('change', '/project/DIA_Test.d');

      expect(win.webContents.send).toHaveBeenCalledWith('fileWatcher:changed', {
        type: 'change',
        filePath: '/project/DIA_Test.d',
      });
    });
  });
});
