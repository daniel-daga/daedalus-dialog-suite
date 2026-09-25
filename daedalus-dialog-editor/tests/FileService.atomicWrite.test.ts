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

  it('publishes staged metadata before rename and completes the observer before the cache stat', async () => {
    const lifecycle: Array<{ phase: string; token?: unknown; signature?: { mtimeMs: number; size: number }; succeeded?: boolean }> = [];
    service.setSelfWriteObserver({
      begin: (_filePath, signature) => {
        const token = {};
        lifecycle.push({ phase: 'begin', token, signature });
        return token;
      },
      finish: (token, succeeded) => lifecycle.push({ phase: 'finish', token, succeeded }),
    });

    await service.writeFile(target, 'updated content');

    expect(lifecycle).toHaveLength(2);
    expect(lifecycle[0].phase).toBe('begin');
    expect(lifecycle[1]).toMatchObject({ phase: 'finish', token: lifecycle[0].token, succeeded: true });
    expect(lifecycle[0].signature).toEqual({
      mtimeMs: (await fs.stat(target)).mtimeMs,
      size: Buffer.byteLength('updated content'),
    });
  });

  it('does not adopt an external replacement made before the post-write cache stat', async () => {
    let selfWriteSignature: { mtimeMs: number; size: number } | undefined;
    service.setSelfWriteObserver({
      begin: (_filePath, signature) => {
        selfWriteSignature = signature;
        return {};
      },
      finish: () => undefined,
    });
    const realStat = fs.stat.bind(fs);
    let statCalls = 0;
    jest.spyOn(fs, 'stat').mockImplementation(async (...args: any[]) => {
      statCalls += 1;
      // This write has no expectUnchanged precondition; replace the target on
      // the post-rename cache refresh.
      if (statCalls === 1) {
        await fs.writeFile(target, 'external replacement with another size');
      }
      return (realStat as any)(...args);
    });

    await service.writeFile(target, 'editor content');

    const externalStat = await realStat(target);
    expect(selfWriteSignature).toBeDefined();
    expect(selfWriteSignature).not.toEqual({ mtimeMs: externalStat.mtimeMs, size: externalStat.size });
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
    const finish = jest.fn();
    service.setSelfWriteObserver({
      begin: () => 'write-token',
      finish: (token, succeeded) => finish(token, succeeded),
    });
    jest.spyOn(fs, 'rename').mockImplementation(async () => {
      throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    });

    await expect(service.writeFile(target, 'never persists')).rejects.toThrow();
    expect(finish).toHaveBeenCalledWith('write-token', false);
    jest.restoreAllMocks();

    expect(await fs.readFile(target, 'utf8')).toBe(original);
    const entries = await fs.readdir(tempDir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });
});

describe('FileService backup before destructive force-save', () => {
  let tempDir: string;
  let service: FileService;
  let target: string;
  let backup: string;

  beforeEach(async () => {
    tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'force-backup-'));
    service = new FileService();
    service.clearEncodingCache();
    target = path.join(tempDir, 'DIA_Test.d');
    backup = `${target}.bak`;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (fsSync.existsSync(tempDir)) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('copies the original bytes to <name>.d.bak before a backup-requested write', async () => {
    // Non-ASCII windows-1252 bytes (e.g. 0xE4 'ä') so an encode/decode
    // roundtrip in the backup path would be detectable.
    const originalBytes = Buffer.from([
      0x2f, 0x2f, 0x20, 0xe4, 0xf6, 0xfc, 0x0d, 0x0a, 0x66, 0x75, 0x6e, 0x63,
    ]);
    await fs.writeFile(target, originalBytes);
    await service.readFile(target);

    await service.writeFile(target, 'forced content', { backupBeforeWrite: true });

    expect(await fs.readFile(target, 'utf8')).toBe('forced content');
    expect(Buffer.compare(await fs.readFile(backup), originalBytes)).toBe(0);
  });

  it('does not create a backup on a normal save', async () => {
    await fs.writeFile(target, 'original content');
    await service.readFile(target);

    await service.writeFile(target, 'updated content');

    expect(fsSync.existsSync(backup)).toBe(false);
  });

  it('skips the backup when the target file does not exist yet', async () => {
    await service.writeFile(target, 'brand new file', { backupBeforeWrite: true });

    expect(await fs.readFile(target, 'utf8')).toBe('brand new file');
    expect(fsSync.existsSync(backup)).toBe(false);
  });

  it('fails the save and leaves the original untouched when the backup copy fails', async () => {
    await fs.writeFile(target, 'original content');
    await service.readFile(target);

    jest.spyOn(fs, 'copyFile').mockImplementation(async () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });

    await expect(
      service.writeFile(target, 'never persists', { backupBeforeWrite: true })
    ).rejects.toMatchObject({ name: 'FileServiceError', code: 'BACKUP_FAILED' });
    jest.restoreAllMocks();

    expect(await fs.readFile(target, 'utf8')).toBe('original content');
    expect(fsSync.existsSync(backup)).toBe(false);
  });
});
