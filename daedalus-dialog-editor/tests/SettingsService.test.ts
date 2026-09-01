import { SettingsService } from '../src/main/services/SettingsService';
import * as fs from 'fs/promises';
import * as path from 'path';

// SettingsService references `require('fs').promises`; spy on that same object
// (the ESM namespace import above is non-configurable and cannot be spied).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- must spy on the exact object SettingsService uses
const fsPromises = require('fs').promises;

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('./test-userData')
  }
}));

describe('SettingsService', () => {
  let settingsService: SettingsService;
  const testUserDataPath = './test-userData';
  const settingsPath = path.join(testUserDataPath, 'settings.json');

  beforeEach(async () => {
    settingsService = new SettingsService();
    try {
      await fs.mkdir(testUserDataPath, { recursive: true });
    } catch {
      // directory may already exist
    }
  });

  afterEach(async () => {
    try {
      await fs.rm(testUserDataPath, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('should return empty list if no settings file exists', async () => {
    const projects = await settingsService.getRecentProjects();
    expect(projects).toEqual([]);
  });

  it('should add a recent project', async () => {
    await settingsService.addRecentProject('/path/to/project', 'TestProject');
    const projects = await settingsService.getRecentProjects();
    
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('TestProject');
    expect(projects[0].path).toBe('/path/to/project');
    expect(projects[0].lastOpened).toBeDefined();
  });

  it('should move existing project to top when re-added', async () => {
    await settingsService.addRecentProject('/path/1', 'Proj1');
    await settingsService.addRecentProject('/path/2', 'Proj2');
    
    let projects = await settingsService.getRecentProjects();
    expect(projects[0].name).toBe('Proj2');
    expect(projects[1].name).toBe('Proj1');

    await settingsService.addRecentProject('/path/1', 'Proj1');
    projects = await settingsService.getRecentProjects();
    
    expect(projects).toHaveLength(2);
    expect(projects[0].name).toBe('Proj1');
    expect(projects[1].name).toBe('Proj2');
  });

  it('should limit the number of recent projects', async () => {
    for (let i = 0; i < 15; i++) {
      await settingsService.addRecentProject(`/path/${i}`, `Proj${i}`);
    }
    
    const projects = await settingsService.getRecentProjects();
    expect(projects).toHaveLength(10);
    expect(projects[0].name).toBe('Proj14');
  });

  describe('atomic + serialized writes (S6)', () => {
    it('serializes concurrent read-modify-write setters without dropping fields', async () => {
      // Fire three distinct setters concurrently with no awaits between starts.
      // Each is a read-modify-write; without serialization they interleave and
      // clobber one another's fields.
      await Promise.all([
        settingsService.addRecentProject('/path/concurrent', 'Concurrent'),
        settingsService.setUpdaterLastCheckTimestamp(123456),
        settingsService.setUpdaterAutoCheck(false),
      ]);

      const raw = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(raw);

      // All three effects must survive.
      expect(settings.recentProjects).toHaveLength(1);
      expect(settings.recentProjects[0].path).toBe('/path/concurrent');
      expect(settings.updater.lastCheckTimestamp).toBe(123456);
      expect(settings.updater.autoCheckOnStartup).toBe(false);
    });

    it('writes atomically via a temp file + rename', async () => {
      const renameSpy = jest.spyOn(fsPromises, 'rename');

      await settingsService.addRecentProject('/path/atomic', 'Atomic');

      expect(renameSpy).toHaveBeenCalled();
      const [tmpArg, finalArg] = renameSpy.mock.calls[renameSpy.mock.calls.length - 1];
      expect(finalArg).toBe(settingsPath);
      expect(tmpArg).not.toBe(settingsPath);
      expect(String(tmpArg).startsWith(settingsPath)).toBe(true);

      renameSpy.mockRestore();
    });

    it('leaves the previous settings.json intact and rejects when the write fails', async () => {
      // Seed a known-good settings file.
      await settingsService.addRecentProject('/path/original', 'Original');
      const before = await fs.readFile(settingsPath, 'utf8');

      // Force the atomic rename to fail; the previous file must survive and the
      // error must propagate to the caller (no longer swallowed).
      const renameSpy = jest
        .spyOn(fsPromises, 'rename')
        .mockRejectedValueOnce(new Error('ENOSPC: simulated disk full'));

      await expect(
        settingsService.addRecentProject('/path/new', 'New')
      ).rejects.toThrow();

      const after = await fs.readFile(settingsPath, 'utf8');
      expect(after).toBe(before);

      renameSpy.mockRestore();
    });

    it('does not share a temp path between two app instances', async () => {
      // Two instances of the app share one userData directory, and the write
      // queue only serializes within an instance. A fixed `.tmp` name means the
      // second `open(..., 'w')` truncates the first writer's file mid-write and
      // one of the two renames then moves a file the other is still filling.
      const openSpy = jest.spyOn(fsPromises, 'open');
      const otherInstance = new SettingsService();

      await Promise.all([
        settingsService.setGothicInstallPath('C:/Gothic II'),
        otherInstance.addRecentProject('/path/other', 'Other'),
      ]);

      const tmpPaths = openSpy.mock.calls.map((call) => String(call[0]));
      expect(tmpPaths).toHaveLength(2);
      expect(new Set(tmpPaths).size).toBe(2);
      // Still siblings of the real file, so the rename stays on one volume.
      for (const tmpPath of tmpPaths) {
        expect(tmpPath.startsWith(settingsPath)).toBe(true);
        expect(tmpPath).not.toBe(settingsPath);
      }

      openSpy.mockRestore();
    });

    it('retries a rename the other instance is contending for', async () => {
      // Unique temp names are only half of it: Windows fails the rename with
      // EPERM while another writer is renaming onto the same destination (an
      // AV scanner or the indexer holding it does the same). Observed ~1 run in
      // 3 with two instances saving at once, so a save must survive it.
      const contended: NodeJS.ErrnoException = new Error(
        'EPERM: operation not permitted, rename'
      );
      contended.code = 'EPERM';
      const realRename = fsPromises.rename;
      const renameSpy = jest
        .spyOn(fsPromises, 'rename')
        .mockRejectedValueOnce(contended)
        .mockImplementation((...args: unknown[]) => realRename(...args));

      await settingsService.addRecentProject('/path/contended', 'Contended');

      expect(renameSpy).toHaveBeenCalledTimes(2);
      expect(await settingsService.getRecentProjects()).toHaveLength(1);

      renameSpy.mockRestore();
    });

    it('removes its temp file when the rename fails', async () => {
      // Unique names only stay affordable if a failed write cleans up after
      // itself; otherwise every ENOSPC leaves another orphan in userData.
      const renameSpy = jest
        .spyOn(fsPromises, 'rename')
        .mockRejectedValueOnce(new Error('ENOSPC: simulated disk full'));

      await expect(
        settingsService.addRecentProject('/path/new', 'New')
      ).rejects.toThrow();

      const entries = await fs.readdir(testUserDataPath);
      expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([]);

      renameSpy.mockRestore();
    });

    it('preserves a corrupt settings file and falls back to defaults on read', async () => {
      await fs.writeFile(settingsPath, '{ this is not valid json', 'utf8');

      const projects = await settingsService.getRecentProjects();
      expect(projects).toEqual([]);

      const entries = await fs.readdir(testUserDataPath);
      const corruptSiblings = entries.filter((name) =>
        name.startsWith('settings.json.corrupt-')
      );
      expect(corruptSiblings).toHaveLength(1);
    });
  });

  describe('isKnownRecentProject', () => {
    it('returns true for a persisted recent project (normalized)', async () => {
      await settingsService.addRecentProject('/projects/my-mod', 'My Mod');

      expect(await settingsService.isKnownRecentProject('/projects/my-mod')).toBe(true);
      // Normalization: redundant segments resolve to the same path
      expect(await settingsService.isKnownRecentProject('/projects/sub/../my-mod')).toBe(true);
    });

    it('returns false for a path that was never opened', async () => {
      await settingsService.addRecentProject('/projects/my-mod', 'My Mod');

      expect(await settingsService.isKnownRecentProject('/etc')).toBe(false);
      expect(await settingsService.isKnownRecentProject('/projects/other-mod')).toBe(false);
    });

    it('returns false for empty or non-string input', async () => {
      expect(await settingsService.isKnownRecentProject('')).toBe(false);
      // @ts-expect-error testing defensive runtime guard
      expect(await settingsService.isKnownRecentProject(undefined)).toBe(false);
    });
  });

  describe('gothicInstallPath', () => {
    it('is null until a Gothic install has been chosen', async () => {
      // Never a guess: an install that is not there must not be invented, or
      // the World surface mounts nothing and blames the world for it.
      expect(await settingsService.getGothicInstallPath()).toBeNull();
    });

    it('round-trips through the settings file', async () => {
      await settingsService.setGothicInstallPath('C:/Gothic II');
      expect(await settingsService.getGothicInstallPath()).toBe('C:/Gothic II');
    });

    it('does not disturb the recent projects it shares a file with', async () => {
      // Both seed the path whitelist, and both are read-modify-write on one
      // JSON file — dropping the other's field is a security regression, not
      // just a lost preference.
      await settingsService.addRecentProject('/projects/my-mod', 'My Mod');
      await settingsService.setGothicInstallPath('C:/Gothic II');

      expect(await settingsService.getRecentProjects()).toHaveLength(1);
      expect(await settingsService.getGothicInstallPath()).toBe('C:/Gothic II');
    });
  });
});
