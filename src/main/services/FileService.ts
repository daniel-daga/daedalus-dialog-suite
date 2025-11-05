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
    try {
      // Read file as buffer first
      const buffer = await fs.readFile(filePath);

      // Detect encoding
      let detectedEncoding = chardet.detect(buffer);

      // Normalize encoding names and handle common variants
      // chardet sometimes detects windows-1252 when it should be windows-1250
      // For Central European files, prefer win1250
      if (detectedEncoding === 'windows-1252' || detectedEncoding === 'ISO-8859-1') {
        // Try to detect if it's actually windows-1250 by checking for specific byte patterns
        // Windows-1250 is commonly used for Central European languages
        detectedEncoding = 'windows-1250';
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
  }

  /**
   * Write content to a file using the original encoding if available
   * @param filePath - Absolute path to the file
   * @param content - Content to write
   * @returns Success status with encoding information
   * @throws {FileServiceError} If file cannot be written
   */
  async writeFile(filePath: string, content: string): Promise<{ success: boolean; encoding?: string }> {
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