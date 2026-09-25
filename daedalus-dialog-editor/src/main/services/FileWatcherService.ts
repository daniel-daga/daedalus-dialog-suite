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
import { statSync } from 'fs';
import { canonicalPathKey } from '../utils/pathKey';

interface PathStats {
  isFile(): boolean;
  isDirectory(): boolean;
}

export type FileChangeType = 'change' | 'add' | 'unlink';

export interface FileChangeEvent {
  type: FileChangeType;
  filePath: string;
}

export interface SelfWriteSignature {
  mtimeMs: number;
  size: number;
}

interface SelfWriteToken {
  key: string;
  generation: number;
  id: number;
  signature: SelfWriteSignature;
}

interface PendingFileEvent {
  event: FileChangeEvent;
  observedSignature?: SelfWriteSignature;
}

export class FileWatcherService {
  private watcher: FSWatcher | null = null;
  private window: BrowserWindow | null = null;
  private watchedPath: string | null = null;

  private generation = 0;
  private nextSelfWriteId = 1;
  private selfWriteSignatures = new Map<string, SelfWriteSignature>();
  private inFlightWrites = new Map<string, Set<number>>();
  private pendingEvents = new Map<string, PendingFileEvent[]>();

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

  /** Start deferring watcher events until an atomic write's rename resolves. */
  beginSelfWrite(filePath: string, signature: SelfWriteSignature): SelfWriteToken | null {
    if (!this.watcher) return null;
    const key = canonicalPathKey(filePath);
    const id = this.nextSelfWriteId++;
    const writes = this.inFlightWrites.get(key) ?? new Set<number>();
    writes.add(id);
    this.inFlightWrites.set(key, writes);
    return { key, generation: this.generation, id, signature };
  }

  /** Finish a write and classify events that arrived while its rename was pending. */
  finishSelfWrite(token: SelfWriteToken | null, succeeded: boolean): void {
    if (!token) return;
    if (token.generation !== this.generation) return;
    const writes = this.inFlightWrites.get(token.key);
    if (!writes?.delete(token.id)) return;
    if (writes.size === 0) this.inFlightWrites.delete(token.key);
    if (succeeded) {
      this.selfWriteSignatures.set(token.key, token.signature);
    }
    if (!this.inFlightWrites.has(token.key)) {
      const queued = this.pendingEvents.get(token.key) ?? [];
      this.pendingEvents.delete(token.key);
      for (const pending of queued) {
        const wasDifferentAtDelivery = succeeded &&
          (pending.event.type === 'unlink' || !pending.observedSignature ||
            pending.observedSignature.mtimeMs !== token.signature.mtimeMs ||
            pending.observedSignature.size !== token.signature.size);
        this.classifyEvent(pending.event, wasDifferentAtDelivery);
      }
    }
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

    const generation = this.generation;
    this.watcher.on('change', (filePath: string) => this.receiveEvent('change', filePath, generation));
    this.watcher.on('add', (filePath: string) => this.receiveEvent('add', filePath, generation));
    this.watcher.on('unlink', (filePath: string) => this.receiveEvent('unlink', filePath, generation));

    this.watcher.on('error', (error: unknown) => {
      console.error('[FileWatcher] Error:', error instanceof Error ? error.message : error);
    });
  }

  /**
   * Stop watching (e.g. when project is closed).
   */
  async stopWatching(): Promise<void> {
    this.generation++;
    this.selfWriteSignatures.clear();
    this.inFlightWrites.clear();
    this.pendingEvents.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.watchedPath = null;
    }
  }

  /**
   * The path currently being watched, or null.
   */
  getWatchedPath(): string | null {
    return this.watchedPath;
  }

  private handleEvent(type: FileChangeType, filePath: string): void {
    const key = canonicalPathKey(filePath);
    if (this.inFlightWrites.has(key)) {
      const queued = this.pendingEvents.get(key) ?? [];
      let observedSignature: SelfWriteSignature | undefined;
      try {
        const stat = statSync(filePath);
        observedSignature = { mtimeMs: stat.mtimeMs, size: stat.size };
      } catch {
        // Keep unknown observations queued; a failed stat must never discard an event.
      }
      queued.push({ event: { type, filePath }, observedSignature });
      this.pendingEvents.set(key, queued);
      return;
    }

    this.classifyEvent({ type, filePath });
  }

  private receiveEvent(type: FileChangeType, filePath: string, generation: number): void {
    if (generation !== this.generation) return;
    // Controlled delay for the real-Electron regression spec. The environment
    // variable is only set by that harness; normal app event delivery stays
    // synchronous with chokidar's callback.
    const delay = Number(process.env.DDE_E2E_DELAY_FILE_WATCHER_EVENT_MS);
    if (Number.isFinite(delay) && delay > 0) {
      setTimeout(() => {
        if (generation === this.generation) this.handleEvent(type, filePath);
      }, delay);
      return;
    }
    this.handleEvent(type, filePath);
  }

  private classifyEvent(event: FileChangeEvent, forceExternal = false): void {
    const { filePath } = event;
    const key = canonicalPathKey(filePath);
    const signature = this.selfWriteSignatures.get(key);
    if (forceExternal) {
      this.forwardExternalEvent(event);
      return;
    }
    if (signature) {
      try {
        const current = statSync(filePath);
        if (current.mtimeMs === signature.mtimeMs && current.size === signature.size) return;
      } catch {
        // Missing/unreadable files are external changes and must reach renderer.
      }
      this.selfWriteSignatures.delete(key);
    }

    this.forwardExternalEvent(event);
  }

  private forwardExternalEvent(event: FileChangeEvent): void {
    const { filePath, type } = event;
    // Genuine external change: invalidate main-process caches before notifying
    // the renderer, so a self-write never nukes its own fresh cache entry.
    if (this.onExternalChange) {
      this.onExternalChange(filePath, type);
    }

    // Send to renderer via IPC
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('fileWatcher:changed', event);
    }
  }
}
