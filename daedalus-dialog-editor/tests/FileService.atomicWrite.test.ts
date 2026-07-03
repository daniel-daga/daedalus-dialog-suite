/**
 * Atomic-write tests for FileService (fix-02 E5).
 *
 * The write path must go through a temp file + rename so that a crash or I/O
 * failure mid-write can never truncate the original target file.
 *
 * @jest-environment node
 */

import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileService } from '../src/main/services/FileService';

jest.mock('electron', () => ({ dialog: {} }));

describe('FileService atomic write (E5)', () => {
  let tempDir: string;
  let service: FileService;
  let target: string;

  beforeEach(async () => {
    tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
    service = new FileService();
    service.clearEncodingCache();
    target = path.join(tempDir, 'DIA_Test.d');
    await fs.writeFile(target, 'original content');
    // Prime the encoding/stat caches via a real read.
    await service.readFile(target);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (fsSync.existsSync(tempDir)) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes content atomically and leaves no temp residue', async () => {
    await service.writeFile(target, 'hello world');

    expect(await fs.readFile(target, 'utf8')).toBe('hello world');
    const entries = await fs.readdir(tempDir);
    expect(entries).toEqual(['DIA_Test.d']);
  });

  it('leaves the original file intact when the write fails mid-way', async () => {
    const original = await fs.readFile(target, 'utf8');

    // Simulate a crash after only part of the buffer reaches the temp file.
    const realOpen = fs.open.bind(fs);
    jest.spyOn(fs, 'open').mockImplementation(async (p: any, flags: any) => {
      const handle = await (realOpen as any)(p, flags);
      const origWrite = handle.write.bind(handle);
      handle.write = async (buf: any) => {
        const half = Math.max(1, Math.floor(Buffer.from(buf).length / 2));
        await origWrite(Buffer.from(buf).subarray(0, half));
        throw Object.assign(new Error('simulated crash mid-write'), { code: 'EIO' });
      };
      return handle;
    });

    await expect(service.writeFile(target, 'BRAND NEW CONTENT')).rejects.toThrow();
    jest.restoreAllMocks();

    // Original target must be untouched, and no temp file left behind.
    expect(await fs.readFile(target, 'utf8')).toBe(original);
    const entries = await fs.readdir(tempDir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });

  it('retries a transient EPERM rename and then succeeds', async () => {
    const realRename = fs.rename.bind(fs);
    let calls = 0;
    jest.spyOn(fs, 'rename').mockImplementation(async (from: any, to: any) => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      }
      return (realRename as any)(from, to);
    });

    await service.writeFile(target, 'updated content');

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(await fs.readFile(target, 'utf8')).toBe('updated content');
  });

  it('throws and preserves the original when rename fails persistently', async () => {
    const original = await fs.readFile(target, 'utf8');
    jest.spyOn(fs, 'rename').mockImplementation(async () => {
      throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    });

    await expect(service.writeFile(target, 'never persists')).rejects.toThrow();
    jest.restoreAllMocks();

    expect(await fs.readFile(target, 'utf8')).toBe(original);
    const entries = await fs.readdir(tempDir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });
});
