/**
 * PathValidationService - Secure file path validation to prevent security vulnerabilities
 *
 * Protects against:
 * - Directory traversal attacks (../)
 * - Absolute path escapes outside allowed directories
 * - Path normalization bypass attempts
 * - Null bytes and control characters
 * - Symlink/junction escapes (a link inside a whitelisted folder pointing
 *   outside it) — resolved via `validatePathResolved`
 *
 * Whitelist granularity:
 * - `allowedRoots` are directories granted recursively (project folders the
 *   user explicitly opened via the folder dialog / recent projects).
 * - `allowedFiles` are exact file paths granted individually (single-file
 *   open/save), so selecting one file does not whitelist its whole directory.
 *
 * Notes:
 * - Local `fs` APIs never URL-decode, so `%2e`/`%2f`/`%5c` are ordinary
 *   filename characters and are NOT treated as traversal.
 *
 * TOCTOU caveat: `validatePathResolved` is a check-then-use guard. It resolves
 * symlinks with realpath before containment, but a hostile *concurrently
 * running* local process could still swap a directory for a symlink between
 * validation and the subsequent `fs.writeFile`. Node has no portable
 * O_NOFOLLOW-for-every-ancestor open. The threat model here is a malicious
 * *project folder* (static content), not a hostile concurrent local process
 * (which could do worse things directly). The residual window is accepted.
 *
 * Usage:
 *   const validator = new PathValidationService([projectPath]);
 *   await validator.validatePathResolved(userProvidedPath);           // read
 *   await validator.validatePathResolved(userProvidedPath, { write: true }); // write
 */

import * as path from 'path';
import * as fs from 'fs/promises';

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
  // Directories granted recursively.
  private allowedRoots: Set<string>;
  // Exact file paths granted individually.
  private allowedFiles: Set<string>;

  /**
   * Create a path validation service with a whitelist of allowed base directories
   * @param allowedBasePaths Array of absolute directory paths granted recursively
   */
  constructor(allowedBasePaths: string[]) {
    this.allowedRoots = new Set(allowedBasePaths.map(p => path.normalize(p)));
    this.allowedFiles = new Set();
  }

  /**
   * Segment-aware containment: is `candidate` inside `root` (or equal to it)?
   * Correctly allows siblings whose first segment merely begins with '..'
   * (e.g. `<root>/..backup`), and rejects true traversal and cross-drive paths.
   */
  private isContained(root: string, candidate: string): boolean {
    const rel = path.relative(root, candidate);
    return (
      rel === '' ||
      (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))
    );
  }

  private onSameDrive(a: string, b: string): boolean {
    if (process.platform !== 'win32') return true;
    return path.parse(a).root.toUpperCase() === path.parse(b).root.toUpperCase();
  }

  /**
   * Cheap lexical gates shared by all validators. Returns a normalized absolute
   * path, or throws PathValidationError. Does NOT perform containment.
   */
  private lexicalNormalize(filePath: any): string {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new PathValidationError(
        `Path validation failed: Path must be a non-empty string. Attempted: ${filePath}`,
        filePath,
        'invalid_type'
      );
    }
    if (filePath.includes('\0')) {
      throw new PathValidationError(
        `Path validation failed: Path contains null bytes. Attempted: ${filePath}`,
        filePath,
        'null_byte'
      );
    }
    if (/[\r\n\t]/.test(filePath)) {
      throw new PathValidationError(
        `Path validation failed: Path contains control characters. Attempted: ${filePath}`,
        filePath,
        'control_characters'
      );
    }
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
    if (!path.isAbsolute(normalizedPath)) {
      throw new PathValidationError(
        `Path validation failed: Relative paths not allowed. Attempted: ${filePath}`,
        filePath,
        'relative_path'
      );
    }
    return normalizedPath;
  }

  /**
   * Sync, lexical-only allow check (no symlink resolution). Retained for
   * lightweight callers/tests; the security boundary is `validatePathResolved`.
   * @param filePath Path to validate
   * @returns true if path is lexically within an allowed root or an exact
   *          allowed file, false otherwise
   */
  isPathAllowed(filePath: any): boolean {
    let normalizedPath: string;
    try {
      normalizedPath = this.lexicalNormalize(filePath);
    } catch {
      return false;
    }

    if (this.allowedFiles.has(normalizedPath)) {
      return true;
    }

    for (const root of this.allowedRoots) {
      if (this.onSameDrive(root, normalizedPath) && this.isContained(root, normalizedPath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validate a path lexically (no symlink resolution) and throw if not allowed.
   * Retained for callers/tests that do not need filesystem resolution.
   * @throws PathValidationError if path is not allowed
   */
  validatePath(filePath: any): void {
    const normalizedPath = this.lexicalNormalize(filePath);
    const hasTraversal = typeof filePath === 'string' && filePath.includes('..');

    if (this.allowedFiles.has(normalizedPath)) {
      return;
    }
    for (const root of this.allowedRoots) {
      if (this.onSameDrive(root, normalizedPath) && this.isContained(root, normalizedPath)) {
        return;
      }
    }

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

  /**
   * Resolve the deepest existing ancestor of `normalizedAbsPath` with realpath,
   * then re-join the non-existing tail. Handles save-as targets whose parent
   * directories do not exist yet. Throws if a tail segment is '..'.
   */
  private async resolveDeepestExisting(
    normalizedAbsPath: string,
    original: string
  ): Promise<string> {
    let current = normalizedAbsPath;
    const tail: string[] = [];

    // Walk up until an ancestor resolves with realpath.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const real = await fs.realpath(current);
        // Non-existing tail must never contain '..' (normalize should have
        // removed it for absolute paths; assert defensively).
        if (tail.includes('..')) {
          throw new PathValidationError(
            `Path validation failed: Unexpected parent reference in path. Attempted: ${original}`,
            original,
            'directory_traversal'
          );
        }
        return tail.length ? path.join(real, ...tail) : real;
      } catch (err) {
        if (err instanceof PathValidationError) throw err;
        const parent = path.dirname(current);
        if (parent === current) {
          // Reached filesystem root and nothing resolved; fall back to lexical.
          if (tail.includes('..')) {
            throw new PathValidationError(
              `Path validation failed: Unexpected parent reference in path. Attempted: ${original}`,
              original,
              'directory_traversal'
            );
          }
          return normalizedAbsPath;
        }
        tail.unshift(path.basename(current));
        current = parent;
      }
    }
  }

  /**
   * Canonicalize an allowed directory/file with realpath. Roots/files added
   * from dialogs exist by construction, but tolerate non-existent entries
   * (fall back to the normalized path) so validation degrades gracefully.
   */
  private async canonicalizeAllowed(p: string): Promise<string> {
    try {
      return await fs.realpath(p);
    } catch {
      return p;
    }
  }

  /**
   * Security boundary: resolve symlinks before containment.
   *
   * - Read mode: rejects paths that resolve outside every allowed root and are
   *   not an exact allowed file.
   * - Write mode (`{ write: true }`): additionally rejects when the final
   *   component itself is an existing symlink/reparse point (a symlinked file
   *   inside the root whose target escapes would otherwise pass because its
   *   parent resolves inside the root).
   *
   * @throws PathValidationError if the resolved path is not allowed
   */
  async validatePathResolved(filePath: any, opts?: { write?: boolean }): Promise<void> {
    const normalizedPath = this.lexicalNormalize(filePath);

    // Write mode: reject if the final component is itself a symlink. Catches
    // dangling symlinks pointing outside the root (whose parent still resolves
    // inside), which realpath alone cannot see because the target is missing.
    if (opts?.write) {
      try {
        const st = await fs.lstat(normalizedPath);
        if (st.isSymbolicLink()) {
          throw new PathValidationError(
            `Path validation failed: The target is a symbolic link. Open the real target file instead. Attempted: ${filePath}`,
            filePath,
            'symlink_target'
          );
        }
      } catch (err) {
        if (err instanceof PathValidationError) throw err;
        // Not existing yet (save-as) — nothing to lstat.
      }
    }

    const resolved = await this.resolveDeepestExisting(normalizedPath, String(filePath));

    // Exact allowed file (canonicalized).
    for (const file of this.allowedFiles) {
      const canonFile = await this.canonicalizeAllowed(file);
      if (resolved === canonFile || resolved === path.normalize(file)) {
        return;
      }
    }

    // Recursive allowed roots (canonicalized).
    for (const root of this.allowedRoots) {
      const canonRoot = await this.canonicalizeAllowed(root);
      if (this.onSameDrive(canonRoot, resolved) && this.isContained(canonRoot, resolved)) {
        return;
      }
    }

    throw new PathValidationError(
      `Path validation failed: Path resolves outside the allowed project folder. ` +
        `If this is a symlink or junction, open the real target folder instead. Attempted: ${filePath}`,
      filePath,
      'not_within_allowed_directories'
    );
  }

  /**
   * Add a new allowed base directory (granted recursively).
   * @param basePath Absolute directory path to allow
   */
  addAllowedPath(basePath: string): void {
    this.allowedRoots.add(path.normalize(basePath));
  }

  /**
   * Add a single allowed file (exact path only, not its directory).
   * @param filePath Absolute file path to allow
   */
  addAllowedFile(filePath: string): void {
    this.allowedFiles.add(path.normalize(filePath));
  }

  /**
   * Remove an allowed base path (from both roots and exact files).
   * @param basePath Path to remove from the whitelist
   */
  removeAllowedPath(basePath: string): void {
    const normalized = path.normalize(basePath);
    this.allowedRoots.delete(normalized);
    this.allowedFiles.delete(normalized);
  }

  /**
   * Get all currently allowed paths (roots and exact files).
   * @returns Array of allowed paths (copy, not reference)
   */
  getAllowedPaths(): string[] {
    return [...this.allowedRoots, ...this.allowedFiles];
  }
}
