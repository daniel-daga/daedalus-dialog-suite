import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  discoverProjectFile,
  projectOperationKey,
  parseProjectFile,
  ProjectConfigService,
  resolveProjectConfig,
} from '../src/main/services/ProjectConfigService';
import type { GothicProjectFileV1 } from '../src/shared/projectConfigTypes';

const validConfig = (assetSources: unknown = ['.']): unknown => ({
  version: 1,
  target: 'g2-notr',
  scriptsRoot: '.',
  worlds: [],
  assetSources,
});

describe('ProjectConfigService', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gothic-project-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('discovers the sole Gothic project file', async () => {
    const file = join(root, 'demo.gothicproject.json');
    await writeFile(file, '{}');
    await writeFile(join(root, 'other.json'), '{}');
    expect(await discoverProjectFile(root)).toBe(file);
  });

  test('returns null when legacy migration is required', async () => {
    expect(await discoverProjectFile(root)).toBeNull();
  });

  test('rejects ambiguous project folders', async () => {
    await writeFile(join(root, 'a.gothicproject.json'), '{}');
    await writeFile(join(root, 'b.gothicproject.json'), '{}');
    await expect(discoverProjectFile(root)).rejects.toThrow(/multiple.*gothicproject/i);
  });

  test.each([
    ['malformed JSON', '{', /JSON/i],
    ['unsupported version', { ...validConfig(), version: 2 }, /version/i],
    ['invalid target', { ...validConfig(), target: 'g3' }, /target/i],
    ['absolute scriptsRoot', { ...validConfig(), scriptsRoot: 'C:\\scripts' }, /scriptsRoot/i],
    ['POSIX absolute scriptsRoot', { ...validConfig(), scriptsRoot: '/opt/gothic/scripts' }, /scriptsRoot/i],
    ['missing assetSources', { ...validConfig(), assetSources: undefined }, /assetSources/i],
    ['empty assetSources', validConfig([]), /assetSources/i],
    ['non-string asset source', validConfig(['.', 42]), /assetSources\[1\]/i],
    ['asset sources without project root', validConfig(['assets']), /assetSources.*\./i],
    ['empty asset source', validConfig(['.', '']), /assetSources\[1\]/i],
    ['control character in asset source', validConfig(['.', 'bad\0path']), /assetSources\[1\]/i],
    ['too many asset sources', validConfig(['.', ...Array(128).fill('assets')]), /assetSources/i],
    ['oversized asset source', validConfig(['.', 'x'.repeat(4097)]), /assetSources\[1\]/i],
  ])('rejects %s with a field-specific error', (_name, value, error) => {
    expect(() => parseProjectFile(value)).toThrow(error as RegExp);
  });

  test('rejects invalid world fields precisely', () => {
    expect(() => parseProjectFile({ ...validConfig(), worlds: [{ name: 'x', parts: [{ path: 1, role: 'main' }] }] }))
      .toThrow(/worlds\[0\]\.parts\[0\]\.path/i);
  });

  test('rejects a sparse asset source array', () => {
    const sparse = new Array(2);
    sparse[0] = '.';
    expect(() => parseProjectFile(validConfig(sparse))).toThrow(/assetSources\[1\]/i);
  });

  test('parses JSON text without normalizing configured strings', () => {
    const value = { ...validConfig(['.', 'assets/../assets']) };
    expect(parseProjectFile(JSON.stringify(value))).toEqual(value);
  });

  test('resolves relative sources from the project-file directory and preserves absolute sources', async () => {
    const relative = join(root, 'assets');
    const absolute = join(root, 'external');
    await mkdir(relative);
    await mkdir(absolute);
    const config = parseProjectFile(validConfig(['.', 'assets', absolute]));

    const opened = await resolveProjectConfig(join(root, 'demo.gothicproject.json'), config);

    expect(opened.projectRoot).toBe(root);
    expect(opened.scriptsRoot).toBe(root);
    expect(opened.resolvedAssetSources).toEqual([root, relative, absolute]);
    expect(opened.config.assetSources).toEqual(['.', 'assets', absolute]);
  });

  test('classifies foreign-platform absolute sources as absolute without rewriting their spelling', async () => {
    const foreignAbsolute = process.platform === 'win32' ? '/opt/gothic/assets' : 'C:\\Gothic\\Data';
    const config = parseProjectFile(validConfig(['.', foreignAbsolute]));

    const opened = await resolveProjectConfig(join(root, 'demo.gothicproject.json'), config);

    expect(opened.config.assetSources[1]).toBe(foreignAbsolute);
    expect(opened.warnings[0]).toEqual(expect.objectContaining({
      source: foreignAbsolute,
      resolvedPath: foreignAbsolute,
    }));
  });

  test('warns and omits missing or unreadable sources', async () => {
    const config = parseProjectFile(validConfig(['.', 'missing']));
    const opened = await resolveProjectConfig(join(root, 'demo.gothicproject.json'), config);

    expect(opened.resolvedAssetSources).toEqual([root]);
    expect(opened.warnings).toEqual([expect.objectContaining({
      code: 'asset-source-unavailable',
      source: 'missing',
      resolvedPath: join(root, 'missing'),
    })]);
  });

  test('expands install-shaped folders but mounts ordinary folders directly in configured order', async () => {
    const ordinary = join(root, 'ordinary');
    const install = join(root, 'Gothic');
    const overlay = join(root, 'overlay');
    await mkdir(ordinary);
    await mkdir(join(install, 'Data'), { recursive: true });
    await mkdir(overlay);
    await writeFile(join(install, 'Data', 'Textures.vdf'), 'archive');
    await writeFile(join(install, 'Data', 'Meshes.vdf.disabled'), 'archive');
    const config = parseProjectFile(validConfig(['ordinary', 'Gothic', 'overlay', '.']));

    const opened = await resolveProjectConfig(join(root, 'demo.gothicproject.json'), config);

    expect(opened.resolvedAssetSources).toEqual([
      ordinary,
      join(install, 'Data', 'Textures.vdf'),
      join(install, 'Data', 'Meshes.vdf.disabled'),
      overlay,
      root,
    ]);
  });

  test('recognizes loose compiled Gothic installs', async () => {
    const install = join(root, 'Gothic');
    const compiled = join(install, '_work', 'Data', 'Textures', '_compiled');
    await mkdir(compiled, { recursive: true });
    const config = parseProjectFile(validConfig(['.', 'Gothic']));
    expect((await resolveProjectConfig(join(root, 'p.gothicproject.json'), config)).resolvedAssetSources)
      .toEqual([root, compiled]);
  });

  test('does not treat a directory named like a VDF as an install marker', async () => {
    const assets = join(root, 'assets');
    await mkdir(join(assets, 'Data', 'Textures.vdf'), { recursive: true });
    const config = parseProjectFile(validConfig(['.', 'assets']));

    expect((await resolveProjectConfig(join(root, 'p.gothicproject.json'), config)).resolvedAssetSources)
      .toEqual([root, assets]);
  });

  test('does not treat a file at a compiled-folder path as an install marker', async () => {
    const assets = join(root, 'assets');
    const compiled = join(assets, '_work', 'Data', 'Textures', '_compiled');
    await mkdir(join(assets, '_work', 'Data', 'Textures'), { recursive: true });
    await writeFile(compiled, 'not a directory');
    const config = parseProjectFile(validConfig(['.', 'assets']));

    expect((await resolveProjectConfig(join(root, 'p.gothicproject.json'), config)).resolvedAssetSources)
      .toEqual([root, assets]);
  });

  describe('migration and atomic saves', () => {
    test('canonicalizes equivalent Windows spellings to the same operation queue key', () => {
      const projectFilePath = join(root, 'Demo.gothicproject.json');

      expect(projectOperationKey(projectFilePath, 'win32')).toBe(
        projectOperationKey(join(root, 'sub', '..', 'demo.gothicproject.json'), 'win32'),
      );
    });

    test('creates a default project file named after a legacy folder', async () => {
      const service = new ProjectConfigService();

      const result = await service.openOrMigrate(root, null);

      const projectFilePath = join(root, `${pathBasename(root)}.gothicproject.json`);
      expect(result.migrationCommitted).toBe(true);
      expect(result.project.projectFilePath).toBe(projectFilePath);
      expect(JSON.parse(await readFile(projectFilePath, 'utf8'))).toEqual(validConfig());
    });

    test('appends a legacy install once after the project root', async () => {
      const install = join(root, 'Gothic II');
      await mkdir(install);
      const service = new ProjectConfigService();

      const result = await service.openOrMigrate(root, install);

      expect(result.project.config.assetSources).toEqual(['.', install]);
    });

    test.each([
      ['project root', (projectRoot: string) => projectRoot],
      ['equivalent normalized project root', (projectRoot: string) => join(projectRoot, 'sub', '..')],
    ])('de-duplicates a legacy install equivalent to the %s', async (_name, legacyPath) => {
      const service = new ProjectConfigService();

      const result = await service.openOrMigrate(root, legacyPath(root));

      expect(result.project.config.assetSources).toEqual(['.']);
    });

    test('uses a unique sibling temp file and atomic rename', async () => {
      const fsPromises = require('node:fs').promises;
      const renameSpy = jest.spyOn(fsPromises, 'rename');
      const service = new ProjectConfigService();
      const projectFilePath = join(root, 'demo.gothicproject.json');

      await service.save(projectFilePath, parseProjectFile(validConfig()));

      const [tempPath, destination] = renameSpy.mock.calls.at(-1)!;
      expect(destination).toBe(projectFilePath);
      expect(String(tempPath)).toMatch(new RegExp(`^${escapeRegExp(projectFilePath)}\\.`));
      expect(tempPath).not.toBe(projectFilePath);
      renameSpy.mockRestore();
    });

    test('preserves the old complete file and cleans up the temp file when rename fails', async () => {
      const fsPromises = require('node:fs').promises;
      const service = new ProjectConfigService();
      const projectFilePath = join(root, 'demo.gothicproject.json');
      await writeFile(projectFilePath, JSON.stringify(validConfig(['.'])));
      const before = await readFile(projectFilePath, 'utf8');
      const renameSpy = jest.spyOn(fsPromises, 'rename').mockRejectedValueOnce(new Error('ENOSPC'));

      await expect(service.save(projectFilePath, parseProjectFile(validConfig(['.', 'assets'])))).rejects.toThrow('ENOSPC');

      expect(await readFile(projectFilePath, 'utf8')).toBe(before);
      expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
      renameSpy.mockRestore();
    });

    test('reports no migration and never enriches an existing project from legacy settings', async () => {
      const projectFilePath = join(root, 'existing.gothicproject.json');
      const original = JSON.stringify(validConfig(['.']), null, 2);
      await writeFile(projectFilePath, original);
      const service = new ProjectConfigService();

      const result = await service.openOrMigrate(root, join(root, 'Gothic II'));

      expect(result.migrationCommitted).toBe(false);
      expect(result.project.config.assetSources).toEqual(['.']);
      expect(await readFile(projectFilePath, 'utf8')).toBe(original);
    });

    test('marks an existing project safe for legacy cleanup only when it durably contains that source', async () => {
      const legacy = join(root, 'Gothic II');
      await writeFile(join(root, 'existing.gothicproject.json'), JSON.stringify(validConfig(['.', legacy])));

      expect((await new ProjectConfigService().openOrMigrate(root, legacy)).legacyCleanupSafe).toBe(true);
      expect((await new ProjectConfigService().openOrMigrate(root, join(root, 'other'))).legacyCleanupSafe).toBe(false);
    });

    test('serializes asset updates with other project writes and preserves their non-asset fields', async () => {
      const projectFilePath = join(root, 'demo.gothicproject.json');
      await writeFile(projectFilePath, JSON.stringify(validConfig()));
      const service = new ProjectConfigService();
      const changed = parseProjectFile({ ...validConfig(), target: 'g1' });

      const [, opened] = await Promise.all([
        service.save(projectFilePath, changed),
        service.updateAssetSources(projectFilePath, ['.', 'assets']),
      ]);

      expect(opened.config.target).toBe('g1');
      expect(opened.config.assetSources).toEqual(['.', 'assets']);
    });

    test('refuses an asset update when the project changes externally before publication', async () => {
      const fsPromises = require('node:fs').promises;
      const projectFilePath = join(root, 'demo.gothicproject.json');
      await writeFile(projectFilePath, JSON.stringify(validConfig()));
      const realReadFile = fsPromises.readFile;
      let projectReads = 0;
      jest.spyOn(fsPromises, 'readFile').mockImplementation(async (...args: unknown[]) => {
        if (String(args[0]) === projectFilePath && ++projectReads === 2) {
          await writeFile(projectFilePath, JSON.stringify({ ...validConfig(), target: 'g1' }));
        }
        return realReadFile(...args);
      });

      await expect(new ProjectConfigService().updateAssetSources(projectFilePath, ['.', 'assets']))
        .rejects.toThrow(/changed externally/i);
      expect(JSON.parse(await readFile(projectFilePath, 'utf8')).target).toBe('g1');
    });

    test('serializes simultaneous migrations so the committed file is reused', async () => {
      const service = new ProjectConfigService();

      const [first, second] = await Promise.all([
        service.openOrMigrate(root, join(root, 'first-install')),
        service.openOrMigrate(root, join(root, 'second-install')),
      ]);

      expect([first.migrationCommitted, second.migrationCommitted].filter(Boolean)).toHaveLength(1);
      expect(second.project.config).toEqual(first.project.config);
    });

    test('loses an external atomic publication without overwriting the winner', async () => {
      const fsPromises = require('node:fs').promises;
      const projectFilePath = join(root, `${pathBasename(root)}.gothicproject.json`);
      const winner = validConfig(['.', 'winner-assets']);
      const service = new ProjectConfigService();
      const realLink = fsPromises.link;
      const linkSpy = jest.spyOn(fsPromises, 'link').mockImplementationOnce(async (...args: unknown[]) => {
        await writeFile(projectFilePath, JSON.stringify(winner));
        const exists: NodeJS.ErrnoException = new Error('EEXIST');
        exists.code = 'EEXIST';
        throw exists;
      }).mockImplementation((...args: unknown[]) => realLink(...args));

      const result = await service.openOrMigrate(root, join(root, 'loser-install'));

      expect(result.migrationCommitted).toBe(false);
      expect(result.project.config).toEqual(winner);
      expect(JSON.parse(await readFile(projectFilePath, 'utf8'))).toEqual(winner);
      linkSpy.mockRestore();
    });

    test.each([
      ['stale/dead', JSON.stringify({ pid: 2147483647, token: 'dead-owner' })],
      ['live', JSON.stringify({ pid: process.pid, token: 'live-owner' })],
    ])('does not block on or delete an obsolete %s migration claim', async (_name, owner) => {
      const projectFilePath = join(root, `${pathBasename(root)}.gothicproject.json`);
      const claimPath = `${projectFilePath}.migration.lock`;
      await writeFile(claimPath, owner);

      const result = await new ProjectConfigService().openOrMigrate(root, null);

      expect(result.migrationCommitted).toBe(true);
      expect(await readFile(claimPath, 'utf8')).toBe(owner);
    });

    test('retries a contended rename and cleans up after retry exhaustion', async () => {
      const fsPromises = require('node:fs').promises;
      const service = new ProjectConfigService();
      const projectFilePath = join(root, 'demo.gothicproject.json');
      const contended: NodeJS.ErrnoException = new Error('EACCES');
      contended.code = 'EACCES';
      const renameSpy = jest.spyOn(fsPromises, 'rename').mockRejectedValue(contended);

      await expect(service.save(projectFilePath, parseProjectFile(validConfig()))).rejects.toThrow('EACCES');

      expect(renameSpy).toHaveBeenCalledTimes(5);
      expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
      renameSpy.mockRestore();
    });
  });
});

function pathBasename(value: string): string {
  return value.replace(/[\\/]$/, '').split(/[\\/]/).at(-1)!;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Compile-time assertion that parsing exposes the shared contract.
const _config: GothicProjectFileV1 = parseProjectFile(validConfig());
void _config;
