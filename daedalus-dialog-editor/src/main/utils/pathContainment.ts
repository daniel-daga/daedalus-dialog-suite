import * as path from 'path';

/**
 * Segment-aware containment: is `candidate` inside `root` (or equal to it)?
 * Both paths are compared as given, so pass real paths (`fs.realpath`) when
 * links matter. A sibling whose first segment merely begins with `..`
 * (`<root>/..backup`) is inside; a different drive is not.
 *
 * The project scan and the file watcher use this to apply the rule
 * `PathValidationService` enforces on reads (`docs/architecture/
 * security-model.md`): a link whose real path leaves the project root is not
 * part of the project (#544).
 */
export function isPathInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))
  );
}
