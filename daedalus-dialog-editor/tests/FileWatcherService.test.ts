/**
 * Unit tests for FileWatcherService
 *
 * Tests the main-process file watcher that monitors project directories for
 * external .d file changes and forwards events to the renderer window.
 *
 * @jest-environment node
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
  let tempDir: string;
  let watchedFile: string;

  beforeEach(() => {
    service = new FileWatcherService();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-self-write-'));
    watchedFile = path.join(tempDir, 'DIA_Test.d');
    fs.writeFileSync(watchedFile, 'editor write');
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await service.stopWatching();
    fs.rmSync(tempDir, { recursive: true, force: true });
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

      const stat = fs.statSync(watchedFile);
      const token = service.beginSelfWrite(watchedFile, { mtimeMs: stat.mtimeMs, size: stat.size });
      service.finishSelfWrite(token, true);
      mockWatcher._emit('change', watchedFile);

      expect(cb).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Self-write suppression
  // -------------------------------------------------------------------------

  describe('self-write suppression', () => {
    const signature = () => {
      const stat = fs.statSync(watchedFile);
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    };

    it('suppresses delayed and duplicate events while disk still matches the write', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching(tempDir);

      const token = service.beginSelfWrite(watchedFile, signature());
      service.finishSelfWrite(token, true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      mockWatcher._emit('change', watchedFile);
      mockWatcher._emit('change', watchedFile);

      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('forwards an event when the current metadata differs', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      const cb = jest.fn();
      service.setOnExternalChange(cb);
      await service.startWatching(tempDir);

      const token = service.beginSelfWrite(watchedFile, signature());
      service.finishSelfWrite(token, true);
      fs.writeFileSync(watchedFile, 'external content with different size');
      mockWatcher._emit('change', watchedFile);

      expect(cb).toHaveBeenCalledWith(watchedFile, 'change');
      expect(win.webContents.send).toHaveBeenCalledTimes(1);
    });

    it('forwards an event when the signature path can no longer be statted', async () => {
      const cb = jest.fn();
      service.setOnExternalChange(cb);
      await service.startWatching(tempDir);
      const token = service.beginSelfWrite(watchedFile, signature());
      service.finishSelfWrite(token, true);
      fs.unlinkSync(watchedFile);

      mockWatcher._emit('change', watchedFile);

      expect(cb).toHaveBeenCalledWith(watchedFile, 'change');
    });

    it('queues events until the atomic rename outcome is known', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      const cb = jest.fn();
      service.setOnExternalChange(cb);
      await service.startWatching(tempDir);

      const token = service.beginSelfWrite(watchedFile, signature());
      mockWatcher._emit('change', watchedFile);
      expect(cb).not.toHaveBeenCalled();
      expect(win.webContents.send).not.toHaveBeenCalled();
      service.finishSelfWrite(token, true);

      expect(cb).not.toHaveBeenCalled();
      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('forwards queued events against disk after a failed rename', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      const cb = jest.fn();
      service.setOnExternalChange(cb);
      await service.startWatching(tempDir);

      const token = service.beginSelfWrite(watchedFile, { mtimeMs: 0, size: 99 });
      mockWatcher._emit('change', watchedFile);
      service.finishSelfWrite(token, false);

      expect(cb).toHaveBeenCalledWith(watchedFile, 'change');
    });

    it('preserves an external event observed during a write even if the rename later replaces it', async () => {
      const cb = jest.fn();
      service.setOnExternalChange(cb);
      await service.startWatching(tempDir);
      const staged = path.join(tempDir, 'staged.tmp');
      fs.writeFileSync(staged, 'editor output');
      const stagedStat = fs.statSync(staged);
      const token = service.beginSelfWrite(watchedFile, {
        mtimeMs: stagedStat.mtimeMs,
        size: stagedStat.size,
      });

      fs.writeFileSync(watchedFile, 'external edit with a distinct size');
      mockWatcher._emit('change', watchedFile);
      fs.renameSync(staged, watchedFile);
      service.finishSelfWrite(token, true);

      expect(cb).toHaveBeenCalledWith(watchedFile, 'change');
    });

    it('does not discard a queued unlink when the target is recreated by the write', async () => {
      const cb = jest.fn();
      service.setOnExternalChange(cb);
      await service.startWatching(tempDir);
      const staged = path.join(tempDir, 'staged.tmp');
      fs.writeFileSync(staged, 'editor output');
      const stagedStat = fs.statSync(staged);
      const token = service.beginSelfWrite(watchedFile, {
        mtimeMs: stagedStat.mtimeMs,
        size: stagedStat.size,
      });

      fs.unlinkSync(watchedFile);
      mockWatcher._emit('unlink', watchedFile);
      fs.renameSync(staged, watchedFile);
      service.finishSelfWrite(token, true);

      expect(cb).toHaveBeenCalledWith(watchedFile, 'unlink');
    });

    it('clears committed signatures and pending events on stop/restart', async () => {
      const win = makeMockWindow();
      service.setWindow(win as any);
      await service.startWatching(tempDir);

      const token = service.beginSelfWrite(watchedFile, signature());
      mockWatcher._emit('change', watchedFile);
      await service.stopWatching();
      service.finishSelfWrite(token, true);

      await service.startWatching(tempDir);
      mockWatcher._emit('change', watchedFile);

      expect(win.webContents.send).toHaveBeenCalledWith('fileWatcher:changed', {
        type: 'change',
        filePath: watchedFile,
      });
    });
  });
});
