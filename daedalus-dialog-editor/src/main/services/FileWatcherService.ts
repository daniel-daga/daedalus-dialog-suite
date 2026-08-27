/**
 * FileWatcherService - Watches project directories for external file changes
 *
 * Uses chokidar to monitor .d files in the project folder and emits events
 * when files are added, changed, or removed outside the editor. This allows
 * the renderer to refresh its semantic model cache accordingly.
 *
 * Self-originated writes (from the editor's own save operations) are tracked
 * via an ignore list so they don't trigger unnecessary re-parses.
 */

import { watch, type FSWatcher } from 'chokidar';
import * as path from 'path';
import type { BrowserWindow } from 'electron';

interface PathStats {
  isFile(): boolean;
  isDirectory(): boolean;
}

/**
 * Normalize a path for self-write suppression matching. The notifier and the
 * watcher may disagree on separators (and casing on Windows), so we compare on
 * a canonical key: forward slashes everywhere, lowercased on win32.
 */
function selfWriteKey(filePath: string): string {
  const unified = path.normalize(filePath).replace(/\\/g, '/');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
}

export type FileChangeType = 'change' | 'add' | 'unlink';

export interface FileChangeEvent {
  type: FileChangeType;
  filePath: string;
}

export class FileWatcherService {
  private watcher: FSWatcher | null = null;
  private window: BrowserWindow | null = null;
  private watchedPath: string | null = null;

  /**
   * Paths recently written by the editor itself.
   * Entries are removed after a short timeout so that rapid external edits
   * immediately after an editor save are still detected.
   */
  private selfWrittenPaths = new Set<string>();

  /**
   * Optional hook invoked for genuine external changes (after self-write
   * suppression). Used by the main process to invalidate FileService's
   * encoding/stat caches for the changed path.
   */
  private onExternalChange: ((filePath: string, type: FileChangeType) => void) | null = null;

  /**
   * Register the renderer window so events can be sent to it.
   */
  setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  /**
   * Register a callback invoked for every external (non-self-write) change,
   * before the event is forwarded to the renderer. Passing `null` clears it.
   */
  setOnExternalChange(cb: ((filePath: string, type: FileChangeType) => void) | null): void {
    this.onExternalChange = cb;
  }

  /**
   * Mark a file path as "just written by the editor" so the next change
   * event for it is suppressed. The mark expires after 2 seconds.
   */
  notifySelfWrite(filePath: string): void {
    const key = selfWriteKey(filePath);
    this.selfWrittenPaths.add(key);
    // Unref'd: expiring a suppression mark is never a reason to hold the
    // process open. Referenced, each call pins its process for two seconds —
    // the Electron main process in production, and a Jest worker under test,
    // which is force-killed after 500 ms ("A worker process has failed to exit
    // gracefully").
    setTimeout(() => {
      this.selfWrittenPaths.delete(key);
    }, 2000).unref();
  }

  /**
   * Start watching a project directory for .d file changes.
   * Any previous watcher is stopped first.
   */
  async startWatching(projectPath: string): Promise<void> {
    await this.stopWatching();

    this.watchedPath = projectPath;

    this.watcher = watch(projectPath, {
      // Only watch .d files (Daedalus source files); always recurse into
      // directories so their .d files are seen.
      ignored: (filePath: string, stats?: PathStats) => {
        if (filePath === projectPath) return false;
        // Directories must be traversed. Without stats we cannot tell a
        // dotted directory (e.g. "Mod.bak/") from a file, so we do NOT ignore
        // — chokidar will re-evaluate with stats on the next pass.
        if (!stats || stats.isDirectory()) return false;
        return !filePath.toLowerCase().endsWith('.d');
      },
      persistent: true,
      ignoreInitial: true,
      // Wait for writes to finish before emitting
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', (filePath: string) => this.handleEvent('change', filePath));
    this.watcher.on('add', (filePath: string) => this.handleEvent('add', filePath));
    this.watcher.on('unlink', (filePath: string) => this.handleEvent('unlink', filePath));

    this.watcher.on('error', (error: unknown) => {
      console.error('[FileWatcher] Error:', error instanceof Error ? error.message : error);
    });
  }

  /**
   * Stop watching (e.g. when project is closed).
   */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.watchedPath = null;
      this.selfWrittenPaths.clear();
    }
  }

  /**
   * The path currently being watched, or null.
   */
  getWatchedPath(): string | null {
    return this.watchedPath;
  }

  private handleEvent(type: FileChangeType, filePath: string): void {
    // Skip events triggered by the editor's own writes
    const key = selfWriteKey(filePath);
    if (this.selfWrittenPaths.has(key)) {
      this.selfWrittenPaths.delete(key);
      return;
    }

    // Genuine external change: invalidate main-process caches before notifying
    // the renderer, so a self-write never nukes its own fresh cache entry.
    if (this.onExternalChange) {
      this.onExternalChange(filePath, type);
    }

    const event: FileChangeEvent = { type, filePath };

    // Send to renderer via IPC
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('fileWatcher:changed', event);
    }
  }
}
