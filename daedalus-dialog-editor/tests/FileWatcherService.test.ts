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
