import { WorldFoldersService } from '../src/main/services/WorldFoldersService';
import * as fs from 'fs/promises';
import * as path from 'path';

// WorldFoldersService references `require('fs').promises`; spy on that same
// object (SettingsService.test.ts's own comment explains why: the ESM
// namespace import above is non-configurable and cannot be spied).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- must spy on the exact object WorldFoldersService uses
const fsPromises = require('fs').promises;

describe('WorldFoldersService', () => {
  let service: WorldFoldersService;
  const testDir = './test-world-folders';
  const worldPath = path.join(testDir, 'NewWorld.zen');
  const sidecarPath = path.join(testDir, 'NewWorld.folders.json');

  beforeEach(async () => {
    service = new WorldFoldersService();
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('loads an empty state when no sidecar exists yet', async () => {
    await expect(service.load(worldPath)).resolves.toEqual({ folders: [] });
  });

  it('round-trips what it saves', async () => {
    const folders = { folders: [{ id: 'f1', name: 'Quest NPCs', vobPaths: ['0', '0/1'] }] };
    await service.save(worldPath, folders);
    await expect(service.load(worldPath)).resolves.toEqual(folders);
  });

  it('derives the sidecar name from the world file, in the same directory', async () => {
    await service.save(worldPath, { folders: [] });
    await expect(fs.readFile(sidecarPath, 'utf8')).resolves.toBeDefined();
  });

  describe('atomic writes', () => {
    it('writes via a temp file + rename', async () => {
      const renameSpy = jest.spyOn(fsPromises, 'rename');

      await service.save(worldPath, { folders: [] });

      expect(renameSpy).toHaveBeenCalled();
      const [tmpArg, finalArg] = renameSpy.mock.calls[renameSpy.mock.calls.length - 1];
      expect(finalArg).toBe(sidecarPath);
      expect(tmpArg).not.toBe(sidecarPath);
      expect(String(tmpArg).startsWith(sidecarPath)).toBe(true);

      renameSpy.mockRestore();
    });

    it('serializes two saves fired without awaiting the first', async () => {
      // The renderer fires one save per folder mutation and awaits none of
      // them (`WorldSurface`'s persistFolders). Unserialized, and with a temp
      // name fixed at `<target>.tmp`, the second `open` truncates the first's
      // temp file, the first `rename` moves a possibly partial file into
      // place, and the second `rename` fails ENOENT — which is only logged.
      // The sidecar is then torn, and `load` renames a torn one aside as
      // corrupt: the user's folders come back empty.
      const first = { folders: [{ id: 'f1', name: 'First', vobPaths: ['0'] }] };
      const second = {
        folders: [
          { id: 'f1', name: 'First', vobPaths: ['0'] },
          { id: 'f2', name: 'Second', vobPaths: ['1', '2'] },
        ],
      };

      await Promise.all([service.save(worldPath, first), service.save(worldPath, second)]);

      // The last one issued is what is on disk, whole.
      expect(await service.load(worldPath)).toEqual(second);
      // And nothing is left behind for the next save to trip over.
      const leftovers = (await fs.readdir(testDir)).filter((name) => name.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    });

    it('leaves the previous sidecar intact and rejects when the write fails', async () => {
      const original = { folders: [{ id: 'f1', name: 'Original', vobPaths: [] }] };
      await service.save(worldPath, original);
      const before = await fs.readFile(sidecarPath, 'utf8');

      const renameSpy = jest
        .spyOn(fsPromises, 'rename')
        .mockRejectedValueOnce(new Error('ENOSPC: simulated disk full'));

      await expect(
        service.save(worldPath, { folders: [{ id: 'f2', name: 'New', vobPaths: [] }] }),
      ).rejects.toThrow();

      const after = await fs.readFile(sidecarPath, 'utf8');
      expect(after).toBe(before);

      renameSpy.mockRestore();
    });

    it('preserves a corrupt sidecar and falls back to empty on load', async () => {
      await fs.writeFile(sidecarPath, '{ this is not valid json', 'utf8');

      await expect(service.load(worldPath)).resolves.toEqual({ folders: [] });

      const entries = await fs.readdir(testDir);
      const corruptSiblings = entries.filter((name) => name.startsWith('NewWorld.folders.json.corrupt-'));
      expect(corruptSiblings).toHaveLength(1);
    });
  });
});
