import { promises as fs } from 'fs';
import { dialog } from 'electron';
import * as chardet from 'chardet';
import * as iconv from 'iconv-lite';

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
 * Acquires a lock for a file operation
 * Ensures only one operation per file can proceed at a time
 */
async function acquireLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  // Wait for any existing operation on this file to complete
  const existingLock = fileLocks.get(filePath);
  if (existingLock) {
    await existingLock.catch(() => {}); // Ignore errors from previous operations
  }

  // Create a new lock for this operation
  const lockPromise = operation();
  fileLocks.set(filePath, lockPromise);

  try {
    const result = await lockPromise;
    return result;
  } finally {
    // Only delete if this is still the current lock
    if (fileLocks.get(filePath) === lockPromise) {
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

        // Detect encoding
        let detectedEncoding = chardet.detect(buffer);

        // Intelligent encoding detection for Central European vs Western European
        // chardet sometimes confuses windows-1252 with windows-1250
        if (detectedEncoding === 'windows-1252' || detectedEncoding === 'ISO-8859-1') {
          // Check for Central European character byte patterns specific to windows-1250
          // Windows-1250 uses different byte positions than windows-1252 for certain characters
          const hasCentralEuropeanBytes = this.detectCentralEuropeanPattern(buffer);

          if (hasCentralEuropeanBytes) {
            // File contains Central European characters, use windows-1250
            detectedEncoding = 'windows-1250';
          }
          // Otherwise, keep the detected encoding (windows-1252 or ISO-8859-1)
        }

        const encoding = detectedEncoding || 'utf8';

        // Store the detected encoding for later use when writing
        fileEncodingCache.set(filePath, encoding);

        // Decode the buffer using the detected encoding
        const data = iconv.decode(buffer, encoding);
        return data;
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
   * Detect if a buffer contains Central European character byte patterns
   * specific to windows-1250 encoding
   * @param buffer - The file buffer to analyze
   * @returns true if Central European patterns are found
   */
  private detectCentralEuropeanPattern(buffer: Buffer): boolean {
    // Byte values that are distinct to windows-1250 and commonly used in Central European languages:
    // 0x8A (Š), 0x8C (Ś), 0x8D (Ť), 0x8E (Ž), 0x8F (Ź)
    // 0x9A (š), 0x9C (ś), 0x9D (ť), 0x9E (ž), 0x9F (ź)
    // 0xA5 (Ą), 0xAA (Ş), 0xAF (Ż)
    // 0xB9 (ą), 0xBA (ş), 0xBC (ľ), 0xBE (ľ), 0xBF (ż)
    // 0xC8 (Č), 0xD2 (Ň), 0xD5 (Ő), 0xD8 (Ř), 0xDD (Ý)
    // 0xE8 (č), 0xF2 (ň), 0xF5 (ő), 0xF8 (ř)
    const centralEuropeanBytes = new Set([
      0x8A, 0x8C, 0x8D, 0x8E, 0x8F,
      0x9A, 0x9C, 0x9D, 0x9E, 0x9F,
      0xA5, 0xAA, 0xAF,
      0xB9, 0xBA, 0xBC, 0xBE, 0xBF,
      0xC8, 0xD2, 0xD5, 0xD8, 0xDD,
      0xE8, 0xF2, 0xF5, 0xF8
    ]);

    // Check if any of these bytes appear in the file
    for (let i = 0; i < buffer.length; i++) {
      if (centralEuropeanBytes.has(buffer[i])) {
        return true;
      }
    }

    return false;
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
        // Use the cached encoding if available, otherwise default to utf8
        const encoding = fileEncodingCache.get(filePath) || 'utf8';

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