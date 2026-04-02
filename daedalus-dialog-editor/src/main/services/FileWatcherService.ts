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
import type { BrowserWindow } from 'electron';

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
   * Register the renderer window so events can be sent to it.
   */
  setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  /**
   * Mark a file path as "just written by the editor" so the next change
   * event for it is suppressed. The mark expires after 2 seconds.
   */
  notifySelfWrite(filePath: string): void {
    this.selfWrittenPaths.add(filePath);
    setTimeout(() => {
      this.selfWrittenPaths.delete(filePath);
    }, 2000);
  }

  /**
   * Start watching a project directory for .d file changes.
   * Any previous watcher is stopped first.
   */
  async startWatching(projectPath: string): Promise<void> {
    await this.stopWatching();

    this.watchedPath = projectPath;

    this.watcher = watch(projectPath, {
      // Only watch .d files (Daedalus source files)
      ignored: (path: string) => {
        // Allow directories (so we can recurse into them)
        // and .d files; ignore everything else
        if (path === projectPath) return false;
        // If it doesn't end in .d or .D and has no separator after projectPath
        // we need to let directories through
        const lowerPath = path.toLowerCase();
        const hasExtension = lowerPath.lastIndexOf('.') > lowerPath.lastIndexOf('/');
        if (hasExtension && !lowerPath.endsWith('.d')) return true;
        return false;
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
    if (this.selfWrittenPaths.has(filePath)) {
      this.selfWrittenPaths.delete(filePath);
      return;
    }

    const event: FileChangeEvent = { type, filePath };

    // Send to renderer via IPC
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('fileWatcher:changed', event);
    }
  }
}
