/**
 * FileWatcherService - Watches project directories for external file changes
 *
 * Uses chokidar to monitor .d and .src files in the project folder and emits events
 * when files are added, changed, or removed outside the editor. This allows
 * the renderer to refresh its semantic model cache accordingly.
 *
 * Self-originated writes (from the editor's own save operations) are tracked
 * via an ignore list so they don't trigger unnecessary re-parses.
 */

import { watch, type FSWatcher } from 'chokidar';
import type { BrowserWindow } from 'electron';
import { lstatSync, readdirSync, realpathSync, statSync } from 'fs';
import * as path from 'path';
import { canonicalPathKey } from '../utils/pathKey';
import { isPathInside } from '../utils/pathContainment';

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

/**
 * The scan's rule (#544): a link whose real path leaves the project root is
 * not part of the project, so it is neither indexed nor watched. A root that
 * cannot be resolved leaves the rule off rather than ignoring everything.
 *
 * chokidar asks about every path, twice, on the main process, so the answer
 * must not cost a syscall per path (#572). Only a symlink or junction can
 * leave the root, and a directory listing says which entries are links: each
 * folder is listed once, only links are resolved, and each link once. A file
 * behind a linked folder has no link bit of its own, so a path is also outside
 * when one of its folders is; chokidar does not descend into an ignored folder,
 * but the answer does not rely on it.
 *
 * A name the listing does not hold was created after it and is asked about by
 * itself. A removed path is forgotten, so whatever takes its place is judged
 * afresh. A file swapped for a link with no unlink event in between keeps its
 * old answer until then; reads of it are still refused by
 * `PathValidationService`.
 */
function createLinkContainment(projectPath: string): {
  resolvesOutsideRoot(filePath: string): boolean;
  forget(filePath: string, isDirectory: boolean): void;
} {
  let realRoot: string | null = null;
  try {
    realRoot = realpathSync.native(projectPath);
  } catch {
    realRoot = null;
  }
  const rootKey = path.resolve(projectPath);
  // Folder → entry name → whether it is a link; null for an unreadable folder.
  const listings = new Map<string, Map<string, boolean> | null>();
  const folderVerdicts = new Map<string, boolean>();
  const linkVerdicts = new Map<string, boolean>();

  const isLink = (key: string): boolean => {
    const folder = path.dirname(key);
    let listing = listings.get(folder);
    if (listing === undefined) {
      try {
        listing = new Map(readdirSync(folder, { withFileTypes: true })
          .map((entry): [string, boolean] => [entry.name, entry.isSymbolicLink()]));
      } catch {
        listing = null;
      }
      listings.set(folder, listing);
    }
    const name = path.basename(key);
    const known = listing?.get(name);
    if (known !== undefined) return known;
    try {
      // `isSymbolicLink` is true for a Windows junction as well.
      const link = lstatSync(key).isSymbolicLink();
      listing?.set(name, link);
      return link;
    } catch {
      return false; // vanished: chokidar reports it as it sees it
    }
  };

  const linkLeavesRoot = (key: string): boolean => {
    if (!realRoot || !isLink(key)) return false;
    const cached = linkVerdicts.get(key);
    if (cached !== undefined) return cached;
    try {
      const outside = !isPathInside(realRoot, realpathSync.native(key));
      linkVerdicts.set(key, outside);
      return outside;
    } catch {
      return false; // dangling: chokidar reports it as it sees it
    }
  };

  const folderLeavesRoot = (folder: string): boolean => {
    const parent = path.dirname(folder);
    if (folder === rootKey || parent === folder) return false;
    const cached = folderVerdicts.get(folder);
    if (cached !== undefined) return cached;
    const outside = folderLeavesRoot(parent) || linkLeavesRoot(folder);
    folderVerdicts.set(folder, outside);
    return outside;
  };

  return {
    resolvesOutsideRoot(filePath) {
      if (!realRoot) return false;
      const key = path.resolve(filePath);
      if (key === rootKey) return false;
      return folderLeavesRoot(path.dirname(key)) || linkLeavesRoot(key);
    },
    forget(filePath, isDirectory) {
      const key = path.resolve(filePath);
      listings.get(path.dirname(key))?.delete(path.basename(key));
      linkVerdicts.delete(key);
      if (!isDirectory) return;
      const below = key + path.sep;
      for (const cache of [listings, folderVerdicts, linkVerdicts]) {
        for (const cached of cache.keys()) {
          if (cached === key || cached.startsWith(below)) cache.delete(cached);
        }
      }
    },
  };
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
   * encoding cache for the changed path.
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
   * Start watching a project directory for .d and .src file changes.
   * Any previous watcher is stopped first.
   */
  async startWatching(projectPath: string): Promise<void> {
    await this.stopWatching();

    this.watchedPath = projectPath;

    const links = createLinkContainment(projectPath);

    this.watcher = watch(projectPath, {
      // Only watch .d files (Daedalus source files) and the .src lists that
      // decide which of them compile (#568); always recurse into directories
      // so their files are seen.
      ignored: (filePath: string, stats?: PathStats) => {
        if (filePath === projectPath) return false;
        // Directories must be traversed. Without stats we cannot tell a
        // dotted directory (e.g. "Mod.bak/") from a file, so we do NOT ignore
        // — chokidar will re-evaluate with stats on the next pass.
        if (stats && !stats.isDirectory() && !/\.(d|src)$/i.test(filePath)) return true;
        return links.resolvesOutsideRoot(filePath);
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
    this.watcher.on('unlink', (filePath: string) => {
      links.forget(filePath, false);
      this.receiveEvent('unlink', filePath, generation);
    });
    this.watcher.on('unlinkDir', (dirPath: string) => links.forget(dirPath, true));

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
