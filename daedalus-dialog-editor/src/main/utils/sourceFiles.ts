import { promises as fs } from 'fs';
import * as path from 'path';
import { decodeBuffer } from './encodingUtils';
import { isPathInside } from './pathContainment';

/** Daedalus paths are case-insensitive and written with either separator. */
const pathKey = (file: string): string => file.replace(/\\/g, '/').toLowerCase();

/**
 * Every discovered SRC is a possible compilation entry point; keep their union.
 *
 * A list governs its directory tree. Unknown membership must not hide
 * diagnostics or declarations, so a list that cannot be resolved makes that
 * tree fall back to every script in it, while the other lists still apply
 * (#569).
 *
 * The answer is a predicate rather than a list so that each script costs one
 * set lookup plus the wildcard lines of its own folder (#573).
 */
export async function resolveSourceMembership(
  rootPath: string, scripts: string[], sourceLists: string[]
): Promise<(file: string) => boolean> {
  if (sourceLists.length === 0) return () => true;
  const scopes = sourceLists.map(file => path.dirname(file));
  const unknownScopes: string[] = [];
  const known = new Set([...scripts, ...sourceLists].map(pathKey));
  const literals = new Set<string>();
  // Wildcard lines by the folder they name, matched against the file name.
  const wildcards = new Map<string, RegExp[]>();
  // A wildcard in a folder segment cannot be filed under one folder.
  const pathWildcards: RegExp[] = [];
  const toPattern = (text: string): RegExp => new RegExp('^' + text.split(/([*?])/).map(token =>
    token === '*' ? '[^/]*' : token === '?' ? '[^/]' : token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ).join('') + '$');

  for (const sourceList of sourceLists) {
    const listDir = path.dirname(sourceList);
    const distrust = (reason: string, ...also: string[]) => {
      console.warn(`[ProjectService] ${reason} in ${sourceList}; indexing all scripts under ${listDir}`);
      unknownScopes.push(listDir, ...also);
    };
    let content: string;
    try {
      ({ content } = decodeBuffer(await fs.readFile(sourceList)));
    } catch (error) {
      distrust(`cannot read the SRC list (${error instanceof Error ? error.message : error})`);
      continue;
    }
    const lines = content.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '').split(/\r?\n/);
    for (const line of lines) {
      const entry = line.trim().replace(/^"(.*)"$/, '$1');
      if (!entry) continue;
      // SRC files can also contain non-source headers such as _INTERN\SCRIPTBIN.
      if (!/\.(d|src)$/i.test(entry)) continue;
      const isList = /\.src$/i.test(entry);
      // The engine appends an entry to the list's directory, so a leading
      // separator still names a path below it; `path.resolve` would read it
      // as the drive root.
      const relative = entry.replace(/^[\\/]+/, '').replace(/[\\/]/g, path.sep);
      const absolute = path.resolve(listDir, relative);
      if (!isPathInside(rootPath, absolute)) {
        // A nested list outside the project can name scripts anywhere. A script
        // entry cannot: it names files outside the project only, so dropping it
        // hides nothing the project holds.
        if (isList) distrust(`SRC entry ${entry} leaves the project`);
        else console.warn(`[ProjectService] skipping script ${entry} outside the project in ${sourceList}`);
        continue;
      }
      const key = pathKey(absolute);
      if (!/[*?]/.test(key)) {
        if (!known.has(key)) {
          // The missing list would have governed its own folder as well.
          if (isList) distrust(`unresolved SRC entry ${entry}`, path.dirname(absolute));
          else console.warn(`[ProjectService] missing script ${entry} in ${sourceList}`);
        }
        // A nested list is read as an entry point of its own; only scripts are selected.
        if (!isList) literals.add(key);
        continue;
      }
      if (isList) continue;
      const slash = key.lastIndexOf('/');
      const folder = key.slice(0, slash);
      if (/[*?]/.test(folder)) {
        pathWildcards.push(toPattern(key));
      } else {
        const patterns = wildcards.get(folder) ?? [];
        patterns.push(toPattern(key.slice(slash + 1)));
        wildcards.set(folder, patterns);
      }
    }
  }

  return (file: string): boolean => {
    const key = pathKey(file);
    if (literals.has(key)) return true;
    const slash = key.lastIndexOf('/');
    const name = key.slice(slash + 1);
    if (wildcards.get(key.slice(0, slash))?.some(pattern => pattern.test(name))) return true;
    if (pathWildcards.some(pattern => pattern.test(key))) return true;
    return !scopes.some(scope => isPathInside(scope, file)) ||
      unknownScopes.some(scope => isPathInside(scope, file));
  };
}
