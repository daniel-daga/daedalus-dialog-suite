/**
 * External-modification precondition tests for FileService (fix-02 E4 phase 2,
 * #378).
 *
 * A read returns a disk-version token describing the bytes it read. A write
 * given that token as `expectedVersion` is refused (EXTERNAL_MODIFICATION) when
 * the file on disk is no longer that version, rather than clobbering the
 * external edit. The token belongs to the caller's snapshot: no other read
 * advances it.
 *
 * @jest-environment node
 */

import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileService } from '../src/main/services/FileService';

jest.mock('electron', () => ({ dialog: {} }));

async function externalWrite(file: string, content: string): Promise<void> {
  await fs.writeFile(file, content);
  const future = new Date(Date.now() + 60_000);
  await fs.utimes(file, future, future);
}

/**
 * Run `fn` once, right after the next read of `file` has its bytes in hand and
 * before the service does anything else — whichever read API the service uses.
 */
function afterNextRead(file: string, fn: () => Promise<void>): void {
  let fired = false;
  const fire = async () => {
    if (fired) return;
    fired = true;
    await fn();
  };
  const realReadFile = fs.readFile.bind(fs);
  jest.spyOn(fs, 'readFile').mockImplementation(async (...args: any[]) => {
    const result = await (realReadFile as any)(...args);
    if (args[0] === file) await fire();
    return result;
  });
  const realOpen = fs.open.bind(fs);
  jest.spyOn(fs, 'open').mockImplementation(async (...args: any[]) => {
    const handle = await (realOpen as any)(...args);
    if (args[0] === file) {
      const realHandleRead = handle.readFile.bind(handle);
      handle.readFile = async (...readArgs: any[]) => {
        const result = await realHandleRead(...readArgs);
        await fire();
        return result;
      };
    }
    return handle;
  });
}

describe('FileService conflict guard (E4 phase 2)', () => {
  let tempDir: string;
  let service: FileService;

  beforeEach(() => {
    tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'conflict-guard-'));
    service = new FileService();
    service.clearEncodingCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (fsSync.existsSync(tempDir)) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects EXTERNAL_MODIFICATION without writing when the disk changed since the read', async () => {
    const file = path.join(tempDir, 'guard.d');
    await fs.writeFile(file, 'original');
    const { content, version } = await service.readFileVersioned(file);
    expect(content).toBe('original');

    await externalWrite(file, 'external change');

    await expect(
      service.writeFile(file, 'my content', { expectedVersion: version })
    ).rejects.toThrow(/^EXTERNAL_MODIFICATION:/);

    // The refused write must not have touched the file.
    expect(await fs.readFile(file, 'utf8')).toBe('external change');
  });

  it('a preview read does not advance the editor snapshot\'s baseline', async () => {
    const file = path.join(tempDir, 'preview.d');
    await fs.writeFile(file, 'original');
    const { version } = await service.readFileVersioned(file);

    await externalWrite(file, 'external change');
    // Review Changes reads the file to show a diff; it must not bless the
    // editor's older model for writing over the external change.
    await service.readFile(file);

    await expect(
      service.writeFile(file, 'my content', { expectedVersion: version })
    ).rejects.toThrow(/^EXTERNAL_MODIFICATION:/);
    expect(await fs.readFile(file, 'utf8')).toBe('external change');
  });

  it('a token read before an atomic external replacement describes the old bytes', async () => {
    const file = path.join(tempDir, 'race-rename.d');
    await fs.writeFile(file, 'original');
    afterNextRead(file, async () => {
      const staged = path.join(tempDir, 'staged.tmp');
      await fs.writeFile(staged, 'external change');
      const future = new Date(Date.now() + 60_000);
      await fs.utimes(staged, future, future);
      await fs.rename(staged, file);
    });

    const { content, version } = await service.readFileVersioned(file);
    jest.restoreAllMocks();

    expect(content).toBe('original');
    await expect(
      service.writeFile(file, 'my content', { expectedVersion: version })
    ).rejects.toThrow(/^EXTERNAL_MODIFICATION:/);
    expect(await fs.readFile(file, 'utf8')).toBe('external change');
  });

  it('a token read across an in-place external write never pairs old content with the new version', async () => {
    const file = path.join(tempDir, 'race-inplace.d');
    await fs.writeFile(file, 'original');
    afterNextRead(file, () => externalWrite(file, 'external change'));

    const { content, version } = await service.readFileVersioned(file);
    jest.restoreAllMocks();

    // Either the read saw the new bytes and the token admits a write, or it
    // saw the old bytes and the token refuses one — never old bytes + admit.
    const write = service.writeFile(file, 'my content', { expectedVersion: version });
    if (content === 'original') {
      await expect(write).rejects.toThrow(/^EXTERNAL_MODIFICATION:/);
      expect(await fs.readFile(file, 'utf8')).toBe('external change');
    } else {
      expect(content).toBe('external change');
      await expect(write).resolves.toEqual(expect.objectContaining({ success: true }));
    }
  });

  it('returns the version it wrote, which admits the next guarded write', async () => {
    const file = path.join(tempDir, 'chain.d');
    await fs.writeFile(file, 'original');
    const { version } = await service.readFileVersioned(file);

    const first = await service.writeFile(file, 'first save', { expectedVersion: version });
    expect(first.version).toBeDefined();
    expect(first.version).not.toBe(version);
    expect(first.version).toBe((await service.readFileVersioned(file)).version);

    await expect(
      service.writeFile(file, 'second save', { expectedVersion: first.version })
    ).resolves.toEqual(expect.objectContaining({ success: true }));
    expect(await fs.readFile(file, 'utf8')).toBe('second save');
  });

  it('writes when no expected version is given even if the file changed on disk', async () => {
    const file = path.join(tempDir, 'guard2.d');
    await fs.writeFile(file, 'original');
    await service.readFileVersioned(file);

    await externalWrite(file, 'external change');

    await service.writeFile(file, 'my content');

    expect(await fs.readFile(file, 'utf8')).toBe('my content');
  });
});
