/**
 * PathValidationService - Secure file path validation to prevent security vulnerabilities
 *
 * Protects against:
 * - Directory traversal attacks (../)
 * - Absolute path escapes outside allowed directories
 * - Path normalization bypass attempts
 * - Null bytes and control characters
 * - URL-encoded path traversal attempts
 *
 * Usage:
 * const validator = new PathValidationService([projectPath]);
 * if (validator.isPathAllowed(userProvidedPath)) {
 *   // Safe to access
 * }
 * // Or throw on invalid:
 * validator.validatePath(userProvidedPath);
 */

import * as path from 'path';

export class PathValidationError extends Error {
  constructor(
    message: string,
    public readonly attemptedPath: string,
    public readonly reason: string
  ) {
    super(message);
    this.name = 'PathValidationError';
  }
}

export class PathValidationService {
  private allowedPaths: Set<string>;

  /**
   * Create a path validation service with a whitelist of allowed base directories
   * @param allowedBasePaths Array of absolute paths that are allowed to be accessed
   */
  constructor(allowedBasePaths: string[]) {
    // Normalize all paths on construction and store in a Set for O(1) lookup
    this.allowedPaths = new Set(
      allowedBasePaths.map(p => path.normalize(p))
    );
  }

  /**
   * Check if a given path is allowed (within allowed directories)
   * @param filePath Path to validate
   * @returns true if path is allowed, false otherwise
   */
  isPathAllowed(filePath: any): boolean {
    // Type check - must be string
    if (typeof filePath !== 'string') {
      return false;
    }

    // Empty or whitespace-only strings not allowed
    if (filePath.trim() === '') {
      return false;
    }

    // Check for null bytes (path injection attempt)
    if (filePath.includes('\0')) {
      return false;
    }

    // Check for control characters (newlines, carriage returns, etc.)
    if (/[\r\n\t]/.test(filePath)) {
      return false;
    }

    // Check for URL-encoded directory traversal attempts (single and double encoding)
    // %2e = . %2f = / %5c = \ (single encoding)
    // %252e = %2e (double encoding - decoded once becomes single encoding)
    const lowerPath = filePath.toLowerCase();
    if (
      lowerPath.includes('%2e') ||
      lowerPath.includes('%2f') ||
      lowerPath.includes('%5c') ||
      lowerPath.includes('%252e') ||
      lowerPath.includes('%252f') ||
      lowerPath.includes('%255c')
    ) {
      return false;
    }

    // Normalize the path to resolve .., //, etc.
    let normalizedPath: string;
    try {
      normalizedPath = path.normalize(filePath);
    } catch (error) {
      // Path.normalize can throw on invalid inputs
      return false;
    }

    // Convert to absolute path if relative
    // Relative paths are not allowed (must be absolute)
    if (!path.isAbsolute(normalizedPath)) {
      return false;
    }

    // Check if the normalized absolute path is within any of the allowed directories
    for (const allowedPath of this.allowedPaths) {
      // On Windows, ensure paths are on the same drive
      if (process.platform === 'win32') {
        const normalizedDrive = path.parse(normalizedPath).root.toUpperCase();
        const allowedDrive = path.parse(allowedPath).root.toUpperCase();
        if (normalizedDrive !== allowedDrive) {
          continue; // Different drives, check next allowed path
        }
      }

      // Get the relative path from the allowed base to the target
      const relativePath = path.relative(allowedPath, normalizedPath);

      // If relativePath doesn't start with '..' and isn't '', it's within the allowed directory
      // '' means they're the same path (accessing the directory itself)
      if (!relativePath.startsWith('..') && relativePath !== '..') {
        return true;
      }
    }

    // Path is not within any allowed directory
    return false;
  }

  /**
   * Validate a path and throw an error if it's not allowed
   * @param filePath Path to validate
   * @throws PathValidationError if path is not allowed
   */
  validatePath(filePath: any): void {
    // Type check
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new PathValidationError(
        `Path validation failed: Path must be a non-empty string. Attempted: ${filePath}`,
        filePath,
        'invalid_type'
      );
    }

    // Check for null bytes
    if (filePath.includes('\0')) {
      throw new PathValidationError(
        `Path validation failed: Path contains null bytes. Attempted: ${filePath}`,
        filePath,
        'null_byte'
      );
    }

    // Check for control characters
    if (/[\r\n\t]/.test(filePath)) {
      throw new PathValidationError(
        `Path validation failed: Path contains control characters. Attempted: ${filePath}`,
        filePath,
        'control_characters'
      );
    }

    // Check for URL encoding (single and double)
    const lowerPath = filePath.toLowerCase();
    if (
      lowerPath.includes('%2e') ||
      lowerPath.includes('%2f') ||
      lowerPath.includes('%5c') ||
      lowerPath.includes('%252e') ||
      lowerPath.includes('%252f') ||
      lowerPath.includes('%255c')
    ) {
      throw new PathValidationError(
        `Path validation failed: Path contains URL-encoded directory traversal attempt. Attempted: ${filePath}`,
        filePath,
        'url_encoded_traversal'
      );
    }

    // Check for directory traversal BEFORE normalization to catch it in error message
    const hasTraversal = filePath.includes('..');

    // Normalize
    let normalizedPath: string;
    try {
      normalizedPath = path.normalize(filePath);
    } catch (error) {
      throw new PathValidationError(
        `Path validation failed: Path normalization failed. Attempted: ${filePath}`,
        filePath,
        'normalization_failed'
      );
    }

    // Check if absolute
    if (!path.isAbsolute(normalizedPath)) {
      throw new PathValidationError(
        `Path validation failed: Relative paths not allowed. Attempted: ${filePath}`,
        filePath,
        'relative_path'
      );
    }

    // Check if within allowed directories
    let isWithinAllowed = false;
    for (const allowedPath of this.allowedPaths) {
      // On Windows, ensure paths are on the same drive
      if (process.platform === 'win32') {
        const normalizedDrive = path.parse(normalizedPath).root.toUpperCase();
        const allowedDrive = path.parse(allowedPath).root.toUpperCase();
        if (normalizedDrive !== allowedDrive) {
          continue; // Different drives, check next allowed path
        }
      }

      const relativePath = path.relative(allowedPath, normalizedPath);
      if (!relativePath.startsWith('..') && relativePath !== '..') {
        isWithinAllowed = true;
        break;
      }
    }

    if (!isWithinAllowed) {
      // Provide specific error message if directory traversal was detected
      if (hasTraversal) {
        throw new PathValidationError(
          `Path validation failed: Potential directory traversal detected. Attempted: ${filePath}`,
          filePath,
          'directory_traversal'
        );
      }

      throw new PathValidationError(
        `Path validation failed: Path is not within allowed directories. Attempted: ${filePath}`,
        filePath,
        'not_within_allowed_directories'
      );
    }
  }

  /**
   * Add a new allowed base path at runtime
   * @param basePath Absolute path to allow
   */
  addAllowedPath(basePath: string): void {
    const normalized = path.normalize(basePath);
    this.allowedPaths.add(normalized);
  }

  /**
   * Remove an allowed base path
   * @param basePath Path to remove from allowed list
   */
  removeAllowedPath(basePath: string): void {
    const normalized = path.normalize(basePath);
    this.allowedPaths.delete(normalized);
  }

  /**
   * Get all currently allowed base paths
   * @returns Array of allowed paths (copy, not reference)
   */
  getAllowedPaths(): string[] {
    return Array.from(this.allowedPaths);
  }
}
