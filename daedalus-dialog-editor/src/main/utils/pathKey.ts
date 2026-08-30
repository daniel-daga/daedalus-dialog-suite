import * as path from 'path';

/**
 * Canonical key for a file path, so two spellings of the same file map to one
 * entry. The file watcher, the renderer and the editor's own save path may
 * disagree on separators (and on casing on Windows, where the file system does
 * not): normalize, unify on forward slashes, and lowercase on win32 only —
 * a posix file system distinguishes `B.d` from `b.d` and folding it there
 * would merge two genuinely different files.
 *
 * Use it wherever a path becomes a Map/Set key, never where a path is handed
 * to `fs` — the key is a comparison form, not a usable path.
 */
export function canonicalPathKey(filePath: string): string {
  const unified = path.normalize(filePath).replace(/\\/g, '/');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
}
