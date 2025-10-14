import { promises as fs } from 'fs';
import { dialog } from 'electron';

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
 * Service for handling file system operations
 * Uses fs.promises API for modern async/await support
 */
export class FileService {
  /**
   * Read a file from the file system
   * @param filePath - Absolute path to the file
   * @returns File contents as a string
   * @throws {FileServiceError} If file cannot be read
   */
  async readFile(filePath: string): Promise<string> {
    try {
      const data = await fs.readFile(filePath, 'utf8');
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
   * Write content to a file
   * @param filePath - Absolute path to the file
   * @param content - Content to write
   * @returns Success status
   * @throws {FileServiceError} If file cannot be written
   */
  async writeFile(filePath: string, content: string): Promise<{ success: boolean }> {
    try {
      await fs.writeFile(filePath, content, 'utf8');
      return { success: true };
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