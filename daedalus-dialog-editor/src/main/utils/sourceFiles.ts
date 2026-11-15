import { promises as fs } from 'fs';
import * as path from 'path';
import { decodeBuffer } from './encodingUtils';
import { isPathInside } from './pathContainment';

/**
 * Every discovered SRC is a possible compilation entry point; keep their union.
 *
 * A list governs its directory tree. Unknown membership must not hide
 * diagnostics or declarations, so a list that cannot be resolved makes that
 * tree fall back to every script in it, while the other lists still apply
 * (#569).
 */
export async function selectSourceFiles(rootPath: string, scripts: string[], sourceLists: string[]): Promise<string[]> {
  if (sourceLists.length === 0) return scripts;
  const included = new Set<string>();
  const scopes = sourceLists.map(file => path.dirname(file));
  const unknownScopes: string[] = [];
  const candidates = [...scripts, ...sourceLists];
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
      const pattern = absolute.replace(/\\/g, '/').split(/([*?])/).map(token =>
        token === '*' ? '[^/]*' : token === '?' ? '[^/]' : token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      ).join('');
      const matcher = new RegExp(`^${pattern}$`, 'i');
      const matches = candidates.filter(file => matcher.test(file.replace(/\\/g, '/')));
      if (matches.length === 0 && !/[*?]/.test(entry)) {
        // The missing list would have governed its own folder as well.
        if (isList) distrust(`unresolved SRC entry ${entry}`, path.dirname(absolute));
        else console.warn(`[ProjectService] missing script ${entry} in ${sourceList}`);
      }
      for (const file of matches) included.add(file);
    }
  }
  return scripts.filter(file =>
    included.has(file) ||
    !scopes.some(scope => isPathInside(scope, file)) ||
    unknownScopes.some(scope => isPathInside(scope, file))
  );
}
