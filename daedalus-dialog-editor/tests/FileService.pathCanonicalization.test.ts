/**
 * FileService keys its encoding cache, stat cache and per-file locks on a
 * canonical path key (2026-07 4.11), so the file watcher's spelling of a path
 * — different separators, and different casing on Windows — hits the same
 * entries the editor's own read/write path created.
 *
 * @jest-environment node
 */

import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileService, acquireLock } from '../src/main/services/FileService';
import { canonicalPathKey } from '../src/main/utils/pathKey';

jest.mock('electron', () => ({ dialog: {} }));

describe('FileService path canonicalization', () => {
  let tempDir: string;
  let service: FileService;

  beforeEach(() => {
    tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'path-canon-'));
    service = new FileService();
    service.clearEncodingCache();
    service.clearStatCache();
  });

  afterEach(() => {
    if (fsSync.existsSync(tempDir)) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('treats `C:\\A\\b.d` and `c:/a/b.d` as one key on win32', () => {
    const real = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      expect(canonicalPathKey('C:\\A\\b.d')).toBe(canonicalPathKey('c:/a/b.d'));
    } finally {
      Object.defineProperty(process, 'platform', { value: real });
    }
  });

  it('does not fold case on posix, where two spellings are two files', () => {
    const real = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      expect(canonicalPathKey('/a/B.d')).not.toBe(canonicalPathKey('/a/b.d'));
      expect(canonicalPathKey('/a/./b.d')).toBe(canonicalPathKey('/a/b.d'));
    } finally {
      Object.defineProperty(process, 'platform', { value: real });
    }
  });

  it('finds the cached encoding under an unnormalized spelling of the path', async () => {
    const file = path.join(tempDir, 'sub', 'canon.d');
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, 'func void x() {};');
    await service.readFile(file);

    const unnormalized = `${tempDir}${path.sep}sub${path.sep}.${path.sep}canon.d`;
    expect(service.getFileEncoding(unnormalized)).toBe(service.getFileEncoding(file));
    expect(service.getFileEncoding(file)).toBeDefined();
  });

  it('clears the caches when the watcher reports an unnormalized spelling', async () => {
    const file = path.join(tempDir, 'watched.d');
    await fs.writeFile(file, 'func void x() {};');
    await service.readFile(file);
    expect(service.getFileEncoding(file)).toBeDefined();

    const watcherSpelling = `${tempDir}${path.sep}.${path.sep}watched.d`;
    service.clearEncodingCache(watcherSpelling);
    expect(service.getFileEncoding(file)).toBeUndefined();

    // The stat cache must go too, or an expectUnchanged write still trusts it.
    await service.readFile(file);
    await fs.writeFile(file, 'external edit');
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(file, future, future);
    service.clearStatCache(watcherSpelling);
    await expect(
      service.writeFile(file, 'mine', { expectUnchanged: true })
    ).resolves.toEqual(expect.objectContaining({ success: true }));
  });

  it('serializes two spellings of the same path on one lock', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = acquireLock(path.join(tempDir, 'locked.d'), async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('first:end');
    });

    const second = acquireLock(`${tempDir}${path.sep}.${path.sep}locked.d`, async () => {
      order.push('second:start');
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });
});
