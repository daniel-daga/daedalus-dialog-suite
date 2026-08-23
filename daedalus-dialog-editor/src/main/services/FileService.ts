import { promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';
import * as path from 'path';
import { dialog } from 'electron';
import { decodeBuffer, encodeWithRoundtripCheck } from '../utils/encodingUtils';

/**
 * Error types for FileService operations
 */
export class FileServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly filePath?: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'FileServiceError';
  }
}

/**
 * Mapping of file paths to their detected encodings
 * This allows us to preserve the original encoding when saving files
 */
const fileEncodingCache = new Map<string, string>();

/**
 * Mapping of file paths to the `mtimeMs` observed at the last successful read
 * or write. Used by the `expectUnchanged` write precondition (E4 phase 2) to
 * detect an external modification landing before the file watcher fires.
 */
const fileStatCache = new Map<string, number>();

/**
 * Simple lock mechanism to prevent race conditions during file operations
 * Maps file paths to pending operation promises
 */
const fileLocks = new Map<string, Promise<any>>();

/**
 * Rename `from` to `to`, retrying transient Windows locking errors
 * (EPERM/EBUSY from AV scanners or the indexer) a few times before giving up.
 * `rename` is atomic on POSIX and maps to MoveFileExW(MOVEFILE_REPLACE_EXISTING)
 * on Windows, so the target is never observed half-written.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EBUSY') && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Write `buffer` to `filePath` atomically: stage it in a sibling temp file,
 * flush it to disk, then rename over the target. Any failure before the rename
 * leaves the original file untouched; the temp file is best-effort removed.
 *
 * The temp name deliberately does NOT end in `.d` so the file watcher's ignore
 * predicate (which only watches `.d` files) never emits events for the churn.
 */
async function writeFileAtomic(filePath: string, buffer: Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(
    dir,
    `.${base}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  );

  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.write(buffer);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithRetry(tmp, filePath);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // ignore — the temp file is being discarded anyway
      }
    }
    try {
      await fs.unlink(tmp);
    } catch {
      // best effort — temp may never have been created
    }
    throw error;
  }
}

/**
 * Acquires a lock for a file operation.
 * Operations on the same path run strictly one after another by chaining onto
 * the previous operation's promise, forming a per-path queue. (The previous
 * implementation awaited the in-flight lock and then started immediately, so
 * three or more concurrent callers could overlap once the first settled.)
 */
export async function acquireLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  // Chain this operation after whatever is currently queued for the path.
  const previous = fileLocks.get(filePath) ?? Promise.resolve();
  const run = previous.then(() => operation(), () => operation());

  // Store a never-rejecting tail so the next caller chains after this one
  // without inheriting its rejection.
  const tail = run.then(() => undefined, () => undefined);
  fileLocks.set(filePath, tail);

  try {
    return await run;
  } finally {
    // Only delete if no newer operation has queued behind us.
    if (fileLocks.get(filePath) === tail) {
      fileLocks.delete(filePath);
    }
  }
}

/**
 * Service for handling file system operations
 * Uses fs.promises API for modern async/await support
 * Automatically detects and preserves file encodings
 */
export class FileService {
  /**
   * Read a file from the file system with automatic encoding detection
   * @param filePath - Absolute path to the file
   * @returns File contents as a string
   * @throws {FileServiceError} If file cannot be read
   */
  async readFile(filePath: string): Promise<string> {
    return acquireLock(filePath, async () => {
      try {
        // Read file as buffer first
        const buffer = await fs.readFile(filePath);

        // Detect encoding and decode (shared with the metadata extraction path)
        const { content, encoding } = decodeBuffer(buffer);

        // Store the detected encoding for later use when writing
        fileEncodingCache.set(filePath, encoding);

        // Remember the on-disk mtime so a later `expectUnchanged` write can
        // detect an external modification (E4 phase 2).
        try {
          fileStatCache.set(filePath, (await fs.stat(filePath)).mtimeMs);
        } catch {
          // Non-fatal: without a cached mtime the write guard simply no-ops.
        }

        return content;
      } catch (error) {
        const err = error as NodeJS.ErrnoException;

        if (err.code === 'ENOENT') {
          throw new FileServiceError(
            `File not found: ${filePath}`,
            'FILE_NOT_FOUND',
            filePath,
            err
          );
        } else if (err.code === 'EACCES') {
          throw new FileServiceError(
            `Permission denied: ${filePath}`,
            'PERMISSION_DENIED',
            filePath,
            err
          );
        } else {
          throw new FileServiceError(
            `Failed to read file: ${err.message}`,
            'READ_ERROR',
            filePath,
            err
          );
        }
      }
    });
  }

  /**
   * Write content to a file using the original encoding if available
   * @param filePath - Absolute path to the file
   * @param content - Content to write
   * @returns Success status with encoding information
   * @throws {FileServiceError} If file cannot be written
   */
  async writeFile(
    filePath: string,
    content: string,
    opts?: { expectUnchanged?: boolean; backupBeforeWrite?: boolean }
  ): Promise<{ success: boolean; encoding?: string }> {
    return acquireLock(filePath, async () => {
      // --- External-modification precondition (E4 phase 2) ------------------
      // Refuse the write, without touching the file, if the caller expected
      // the file to be unchanged but its on-disk mtime no longer matches the
      // mtime we cached at read time (an edit landed before the watcher fired).
      if (opts?.expectUnchanged) {
        const cachedMtime = fileStatCache.get(filePath);
        if (cachedMtime !== undefined) {
          let diskMtime: number | undefined;
          try {
            diskMtime = (await fs.stat(filePath)).mtimeMs;
          } catch {
            // File is gone — nothing to conflict with; the write recreates it.
            diskMtime = undefined;
          }
          if (diskMtime !== undefined && diskMtime !== cachedMtime) {
            throw new FileServiceError(
              `EXTERNAL_MODIFICATION: ${filePath} was modified on disk since it was last read`,
              'EXTERNAL_MODIFICATION',
              filePath
            );
          }
        }
      }

      // --- Encoding roundtrip + lossy-write policy (E6) ---------------------
      // Use the cached encoding if available. For files the editor never read
      // (e.g. freshly created scripts) default to windows-1252, the encoding
      // Gothic 2 tooling expects — not utf8.
      const hadCache = fileEncodingCache.has(filePath);
      let encoding = fileEncodingCache.get(filePath) || 'windows-1252';
      let { buffer, lossyChars } = encodeWithRoundtripCheck(content, encoding);

      if (lossyChars.length > 0) {
        // Silently upgrade ASCII-detected / uncached files to windows-1252
        // (byte-identical for pure ASCII, and the Gothic tooling default) and
        // re-verify. Never upgrade an explicitly detected multi-byte encoding.
        const upgradable =
          !hadCache || encoding === 'ASCII' || encoding === 'ISO-8859-1';
        if (upgradable && encoding !== 'windows-1252') {
          encoding = 'windows-1252';
          ({ buffer, lossyChars } = encodeWithRoundtripCheck(content, encoding));
          if (lossyChars.length === 0) {
            fileEncodingCache.set(filePath, encoding);
          }
        }

        if (lossyChars.length > 0) {
          const named = lossyChars
            .slice(0, 5)
            .map((l) => `'${l.char}' (position ${l.position})`)
            .join(', ');
          throw new FileServiceError(
            `ENCODING_LOSS: ${lossyChars.length} character(s) cannot be written in ${encoding}: ${named}`,
            'ENCODING_LOSS',
            filePath
          );
        }
      }

      // --- Backup before destructive write ----------------------------------
      // Requested only on the force-on-errors save path, where the generated
      // code silently drops content the parser could not read. Copy the
      // current on-disk bytes verbatim to `<name>.d.bak` (raw byte copy — no
      // encode/decode roundtrip; the suffix keeps it invisible to the `.d`
      // watcher and project scanner) before overwriting. A missing original
      // means there is nothing to lose; any other backup failure refuses the
      // save — better to refuse than to destroy without a backup.
      if (opts?.backupBeforeWrite) {
        try {
          await fs.copyFile(filePath, `${filePath}.bak`);
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code !== 'ENOENT') {
            throw new FileServiceError(
              `BACKUP_FAILED: could not back up ${filePath} before overwriting: ${err.message}`,
              'BACKUP_FAILED',
              filePath,
              err
            );
          }
        }
      }

      // --- Atomic write (E5) ------------------------------------------------
      try {
        await writeFileAtomic(filePath, buffer);

        // Refresh the cached mtime so a subsequent expectUnchanged write does
        // not misfire on our own write.
        try {
          fileStatCache.set(filePath, (await fs.stat(filePath)).mtimeMs);
        } catch {
          // Non-fatal: the next read repopulates the cache.
        }

        return { success: true, encoding };
      } catch (error) {
        const err = error as NodeJS.ErrnoException;

        if (err.code === 'EACCES') {
          throw new FileServiceError(
            `Permission denied: ${filePath}`,
            'PERMISSION_DENIED',
            filePath,
            err
          );
        } else if (err.code === 'ENOSPC') {
          throw new FileServiceError(
            `No space left on device: ${filePath}`,
            'NO_SPACE',
            filePath,
            err
          );
        } else {
          throw new FileServiceError(
            `Failed to write file: ${err.message}`,
            'WRITE_ERROR',
            filePath,
            err
          );
        }
      }
    });
  }

  /**
   * Get the detected encoding for a file
   * @param filePath - Absolute path to the file
   * @returns The detected encoding or undefined if not cached
   */
  getFileEncoding(filePath: string): string | undefined {
    return fileEncodingCache.get(filePath);
  }

  /**
   * Clear the encoding cache for a specific file or all files
   * @param filePath - Optional path to clear specific file, omit to clear all
   */
  clearEncodingCache(filePath?: string): void {
    if (filePath) {
      fileEncodingCache.delete(filePath);
    } else {
      fileEncodingCache.clear();
    }
  }

  /**
   * Clear the mtime stat cache for a specific file or all files. Called on
   * external file-watcher changes so the next `expectUnchanged` write
   * re-reads the disk state instead of trusting a stale mtime.
   * @param filePath - Optional path to clear specific file, omit to clear all
   */
  clearStatCache(filePath?: string): void {
    if (filePath) {
      fileStatCache.delete(filePath);
    } else {
      fileStatCache.clear();
    }
  }

  /**
   * Show an open file dialog
   * @returns Selected file path or null if canceled
   * @throws {FileServiceError} If dialog fails to open
   */
  async openFileDialog(): Promise<string | null> {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Daedalus Scripts', extensions: ['d'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    } catch (error) {
      throw new FileServiceError(
        `Failed to open file dialog: ${(error as Error).message}`,
        'DIALOG_ERROR',
        undefined,
        error as Error
      );
    }
  }

  /**
   * Show a save file dialog
   * @returns Selected file path or null if canceled
   * @throws {FileServiceError} If dialog fails to open
   */
  async saveFileDialog(): Promise<string | null> {
    try {
      const result = await dialog.showSaveDialog({
        filters: [
          { name: 'Daedalus Scripts', extensions: ['d'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      return result.filePath;
    } catch (error) {
      throw new FileServiceError(
        `Failed to open save dialog: ${(error as Error).message}`,
        'DIALOG_ERROR',
        undefined,
        error as Error
      );
    }
  }
}