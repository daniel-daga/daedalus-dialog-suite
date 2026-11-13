import { promises as fs } from 'fs';
import * as path from 'path';
import { decodeBuffer } from './encodingUtils';
import { isPathInside } from './pathContainment';

/** Every discovered SRC is a possible compilation entry point; keep their union. */
export async function selectSourceFiles(rootPath: string, scripts: string[], sourceLists: string[]): Promise<string[]> {
  if (sourceLists.length === 0) return scripts;
  const included = new Set<string>();
  const scopes = sourceLists.map(file => path.dirname(file));
  const candidates = [...scripts, ...sourceLists];
  try {
    for (const sourceList of sourceLists) {
      const { content } = decodeBuffer(await fs.readFile(sourceList));
      const lines = content.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '').split(/\r?\n/);
      for (const line of lines) {
        const entry = line.trim().replace(/^"(.*)"$/, '$1');
        if (!entry) continue;
        const absolute = path.resolve(path.dirname(sourceList), entry.replace(/[\\/]/g, path.sep));
        if (!isPathInside(rootPath, absolute)) throw new Error(`SRC entry leaves the project: ${entry}`);
        const pattern = absolute.replace(/\\/g, '/').split(/([*?])/).map(token =>
          token === '*' ? '[^/]*' : token === '?' ? '[^/]' : token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        ).join('');
        const matcher = new RegExp(`^${pattern}$`, 'i');
        const matches = candidates.filter(file => matcher.test(file.replace(/\\/g, '/')));
        if (matches.length === 0 && !/[*?]/.test(entry)) {
          throw new Error(`Unresolved SRC entry ${entry} in ${sourceList}`);
        }
        for (const file of matches) included.add(file);
      }
    }
  } catch (error) {
    // Unknown membership must not hide diagnostics or declarations.
    console.warn('[ProjectService] cannot resolve SRC lists; indexing all scripts:', error);
    return scripts;
  }
  return scripts.filter(file => included.has(file) || !scopes.some(scope => isPathInside(scope, file)));
}
