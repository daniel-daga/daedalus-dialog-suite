/**
 * Encoding roundtrip tests for FileService (fix-02 E6).
 *
 * Writing must never silently substitute unmappable characters with '?'.
 * Content that roundtrips lossily in the cached/derived encoding is either
 * upgraded to windows-1252 (ASCII-detected / uncached) or refused outright.
 *
 * @jest-environment node
 */

import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as iconv from 'iconv-lite';
import { FileService } from '../src/main/services/FileService';

jest.mock('electron', () => ({ dialog: {} }));

describe('FileService encoding roundtrip (E6)', () => {
  let tempDir: string;
  let service: FileService;

  beforeEach(() => {
    tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'encoding-roundtrip-'));
    service = new FileService();
    service.clearEncodingCache();
  });

  afterEach(() => {
    if (fsSync.existsSync(tempDir)) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('refuses a write with unmappable characters, names the char, and leaves disk unchanged', async () => {
    const file = path.join(tempDir, 'win1252.d');
    // windows-1252 fixture (umlaut is representable in 1252).
    const originalBytes = iconv.encode('// Menü\nvar int x = 1;', 'windows-1252');
    await fs.writeFile(file, originalBytes);
    await service.readFile(file);
    const before = await fs.readFile(file);

    // 'ł' (U+0142) and 'ę' (U+0119) are not representable in windows-1252.
    await expect(service.writeFile(file, 'var string s = "Wałęsa";')).rejects.toThrow(
      /^ENCODING_LOSS:/
    );

    let message = '';
    try {
      await service.writeFile(file, 'Wałęsa');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^ENCODING_LOSS:/);
    expect(message).toContain('ł');

    const after = await fs.readFile(file);
    expect(after.equals(before)).toBe(true);
  });

  it('silently upgrades an ASCII-detected file to windows-1252 for umlaut content', async () => {
    const file = path.join(tempDir, 'ascii.d');
    await fs.writeFile(file, 'var int x = 1;'); // pure ASCII → detected ASCII
    await service.readFile(file);

    const content = 'var string s = "Grüße";'; // Grüße
    const result = await service.writeFile(file, content);

    expect(result.encoding).toBe('windows-1252');
    const raw = await fs.readFile(file);
    expect(iconv.decode(raw, 'windows-1252')).toBe(content);
    // And the cache is now windows-1252 for subsequent blind writes.
    expect(service.getFileEncoding(file)).toBe('windows-1252');
  });

  it('uses the windows-1252 default for a blind write after cache clear', async () => {
    const file = path.join(tempDir, 'blind.d');
    const content = 'Grüße';
    service.clearEncodingCache(file);

    const result = await service.writeFile(file, content);

    expect(result.encoding).toBe('windows-1252');
    const raw = await fs.readFile(file);
    expect(iconv.decode(raw, 'windows-1252')).toBe(content);
  });
});
