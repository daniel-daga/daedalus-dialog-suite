import { promises as fs } from 'fs';
import { dialog } from 'electron';
import * as iconv from 'iconv-lite';
import { decodeBuffer } from '../utils/encodingUtils';

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
 * Simple lock mechanism to prevent race conditions during file operations
 * Maps file paths to pending operation promises
 */
const fileLocks = new Map<string, Promise<any>>();

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
  async writeFile(filePath: string, content: string): Promise<{ success: boolean; encoding?: string }> {
    return acquireLock(filePath, async () => {
      try {
        // Use the cached encoding if available. For files the editor never
        // read (e.g. freshly created scripts) default to windows-1252, the
        // encoding Gothic 2 tooling expects — not utf8.
        const encoding = fileEncodingCache.get(filePath) || 'windows-1252';

        // Encode the content using the appropriate encoding
        const buffer = iconv.encode(content, encoding);

        await fs.writeFile(filePath, buffer);
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