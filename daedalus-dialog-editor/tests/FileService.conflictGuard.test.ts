/**
 * External-modification precondition tests for FileService (fix-02 E4 phase 2).
 *
 * When a caller asks to write with `expectUnchanged`, and the file's on-disk
 * mtime no longer matches the mtime cached at read time, the write is refused
 * (EXTERNAL_MODIFICATION) rather than clobbering the external edit.
 *
 * @jest-environment node
 */

import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileService } from '../src/main/services/FileService';

jest.mock('electron', () => ({ dialog: {} }));

describe('FileService conflict guard (E4 phase 2)', () => {
  let tempDir: string;
  let service: FileService;

  beforeEach(() => {
    tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'conflict-guard-'));
    service = new FileService();
    service.clearEncodingCache();
    service.clearStatCache();
  });

  afterEach(() => {
    if (fsSync.existsSync(tempDir)) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects EXTERNAL_MODIFICATION without writing when the disk mtime changed', async () => {
    const file = path.join(tempDir, 'guard.d');
    await fs.writeFile(file, 'original');
    await service.readFile(file); // caches mtime

    // Simulate an external edit with a distinctly newer mtime.
    await fs.writeFile(file, 'external change');
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(file, future, future);

    await expect(
      service.writeFile(file, 'my content', { expectUnchanged: true })
    ).rejects.toThrow(/^EXTERNAL_MODIFICATION:/);

    // The refused write must not have touched the file.
    expect(await fs.readFile(file, 'utf8')).toBe('external change');
  });

  it('writes when expectUnchanged is not set even if the file changed on disk', async () => {
    const file = path.join(tempDir, 'guard2.d');
    await fs.writeFile(file, 'original');
    await service.readFile(file);

    await fs.writeFile(file, 'external change');
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(file, future, future);

    await service.writeFile(file, 'my content');

    expect(await fs.readFile(file, 'utf8')).toBe('my content');
  });
});
