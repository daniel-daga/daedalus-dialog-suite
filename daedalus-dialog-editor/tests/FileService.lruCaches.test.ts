/**
 * `FileService`'s per-path caches are bounded (production-readiness §3 P3).
 *
 * The encoding cache and the mtime cache grew with every file ever read in a
 * session and were never trimmed. Both now sit on the same LRU idiom
 * `ProjectService.primedModels` already used: newest at the tail, a read or a
 * refresh moves an entry to the tail, and the oldest goes once the cap is
 * passed. Only the encoding cache is observable from outside (`getFileEncoding`),
 * so that is what is pinned here.
 */

import { FileService, FILE_CACHE_CAP } from '../src/main/services/FileService';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('electron', () => ({
  dialog: {},
}));

describe('FileService › the encoding cache is LRU-capped', () => {
  let dir: string;
  let service: FileService;

  const fileAt = (i: number) => path.join(dir, `f${i}.d`);

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-lru-'));
    service = new FileService();
    service.clearEncodingCache();
    await Promise.all(
      Array.from({ length: FILE_CACHE_CAP + 1 }, (_, i) => fs.writeFile(fileAt(i), `// ${i}\n`))
    );
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('drops the oldest entry once the cap is passed', async () => {
    for (let i = 0; i <= FILE_CACHE_CAP; i++) {
      await service.readFile(fileAt(i));
    }

    expect(service.getFileEncoding(fileAt(0))).toBeUndefined();
    expect(service.getFileEncoding(fileAt(1))).toBeDefined();
    expect(service.getFileEncoding(fileAt(FILE_CACHE_CAP))).toBeDefined();
  });

  it('a re-read refreshes an entry so it survives the next eviction', async () => {
    for (let i = 0; i < FILE_CACHE_CAP; i++) {
      await service.readFile(fileAt(i));
    }
    await service.readFile(fileAt(0)); // full; f0 becomes the newest
    await service.readFile(fileAt(FILE_CACHE_CAP)); // over the cap: evicts f1, not f0

    expect(service.getFileEncoding(fileAt(0))).toBeDefined();
    expect(service.getFileEncoding(fileAt(1))).toBeUndefined();
  });
});
