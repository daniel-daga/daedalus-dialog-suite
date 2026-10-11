/**
 * The machine-local thumbnail cache (level-editor.md §16.26 row 1). PNGs the
 * renderer drew, kept under Electron's `userData` and never committed — keyed
 * by the asset's name and the mounts it resolves through, so a rebuilt VDF
 * invalidates what was drawn from the old one.
 *
 * @jest-environment node
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ThumbnailCacheService } from '../src/main/services/ThumbnailCacheService';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must spy on the exact object the service uses
const fsPromises = require('fs').promises;

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')}`;

describe('ThumbnailCacheService', () => {
  const testDir = path.resolve('./test-thumbnail-cache');
  const sourceA = path.join(testDir, 'Meshes.vdf');
  const sourceB = path.join(testDir, 'mod');
  let service: ThumbnailCacheService;

  beforeEach(async () => {
    await fs.mkdir(sourceB, { recursive: true });
    await fs.writeFile(sourceA, 'vdf');
    service = new ThumbnailCacheService(path.join(testDir, 'thumbs'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('the key', () => {
    it('is the same for the same name over the same mounts, whatever the case of the name', async () => {
      const first = await service.keyFor('NW_CRATE.MRM', [sourceA, sourceB]);
      const second = await service.keyFor('nw_crate.mrm', [sourceA, sourceB]);
      expect(first).toBe(second);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes with the name, with the mount list and with its order', async () => {
      const base = await service.keyFor('NW_CRATE.MRM', [sourceA, sourceB]);
      expect(await service.keyFor('NW_BARREL.MRM', [sourceA, sourceB])).not.toBe(base);
      expect(await service.keyFor('NW_CRATE.MRM', [sourceA])).not.toBe(base);
      // Later wins in the VFS, so the same two mounts the other way round can
      // resolve the name to a different file.
      expect(await service.keyFor('NW_CRATE.MRM', [sourceB, sourceA])).not.toBe(base);
    });

    it('changes when a mount is rewritten', async () => {
      const before = await service.keyFor('NW_CRATE.MRM', [sourceA, sourceB]);
      const past = new Date(Date.now() - 60_000);
      await fs.utimes(sourceA, past, past);
      expect(await service.keyFor('NW_CRATE.MRM', [sourceA, sourceB])).not.toBe(before);
    });

    it('tolerates a mount that is not there, as the VFS open does', async () => {
      const key = await service.keyFor('NW_CRATE.MRM', [sourceA, path.join(testDir, 'missing')]);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('the store', () => {
    it('answers null for a thumbnail nobody has drawn', async () => {
      await expect(service.load('a'.repeat(64))).resolves.toBeNull();
    });

    it('round-trips a PNG data URL as a .png file under its key', async () => {
      const key = await service.keyFor('NW_CRATE.MRM', [sourceA]);
      await service.store(key, PNG);
      await expect(service.load(key)).resolves.toBe(PNG);
      const bytes = await fs.readFile(path.join(testDir, 'thumbs', `${key}.png`));
      expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    it('creates the cache directory on first write', async () => {
      await expect(fs.stat(path.join(testDir, 'thumbs'))).rejects.toBeDefined();
      await service.store('b'.repeat(64), PNG);
      await expect(fs.stat(path.join(testDir, 'thumbs'))).resolves.toBeDefined();
    });

    it('writes via a temp file and a rename, so a torn write never becomes a thumbnail', async () => {
      const renameSpy = jest.spyOn(fsPromises, 'rename');
      const key = 'c'.repeat(64);
      await service.store(key, PNG);
      const [tmp, final] = renameSpy.mock.calls[renameSpy.mock.calls.length - 1];
      expect(final).toBe(path.join(testDir, 'thumbs', `${key}.png`));
      expect(tmp).not.toBe(final);
      renameSpy.mockRestore();
    });

    it('refuses anything that is not a PNG data URL', async () => {
      await expect(service.store('d'.repeat(64), 'data:image/jpeg;base64,AAAA')).rejects.toThrow(/PNG/);
      await expect(service.store('d'.repeat(64), `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`))
        .rejects.toThrow(/PNG/);
      await expect(service.store('not a key', PNG)).rejects.toThrow(/key/);
    });
  });
});
