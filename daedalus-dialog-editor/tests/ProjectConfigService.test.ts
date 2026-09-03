import { promises as fsPromises } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  discoverProjectFile,
  findInstallShaped,
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

  test.each([
    ['non-string gmbtProjectDir', { ...(validConfig() as object), gmbtProjectDir: 7 }],
    ['empty gmbtProjectDir', { ...(validConfig() as object), gmbtProjectDir: '' }],
    ['control character in gmbtProjectDir', { ...(validConfig() as object), gmbtProjectDir: 'mod\0dir' }],
    ['oversized gmbtProjectDir', { ...(validConfig() as object), gmbtProjectDir: 'x'.repeat(4097) }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseProjectFile(value)).toThrow(/gmbtProjectDir/i);
  });

  test('resolves a GMBT project folder that carries a .gmbt.yml', async () => {
    const gmbt = join(root, 'gmbt');
    await mkdir(gmbt);
    await writeFile(join(gmbt, '.gmbt.yml'), 'gothicRoot: C:\\Gothic\n');
    const config = parseProjectFile({ ...(validConfig() as object), gmbtProjectDir: 'gmbt' });

    const opened = await resolveProjectConfig(join(root, 'demo.gothicproject.json'), config);

    expect(opened.gmbtProjectDir).toBe(gmbt);
    expect(opened.warnings).toEqual([]);
  });

  test('warns instead of resolving a folder without a .gmbt.yml, and one that is missing', async () => {
    await mkdir(join(root, 'gmbt'));
    const withoutConfig = await resolveProjectConfig(
      join(root, 'demo.gothicproject.json'),
      parseProjectFile({ ...(validConfig() as object), gmbtProjectDir: 'gmbt' }),
    );
    expect(withoutConfig.gmbtProjectDir).toBeNull();
    expect(withoutConfig.warnings).toEqual([expect.objectContaining({
      code: 'gmbt-project-dir-unavailable',
      source: 'gmbt',
      resolvedPath: join(root, 'gmbt'),
      message: expect.stringContaining('.gmbt.yml'),
    })]);

    const missing = await resolveProjectConfig(
      join(root, 'demo.gothicproject.json'),
      parseProjectFile({ ...(validConfig() as object), gmbtProjectDir: 'nowhere' }),
    );
    expect(missing.gmbtProjectDir).toBeNull();
    expect(missing.warnings).toEqual([expect.objectContaining({
      code: 'gmbt-project-dir-unavailable',
      resolvedPath: join(root, 'nowhere'),
    })]);
  });

  test('leaves gmbtProjectDir null when the project file does not name one', async () => {
    const opened = await resolveProjectConfig(
      join(root, 'demo.gothicproject.json'),
      parseProjectFile(validConfig()),
    );
    expect(opened.gmbtProjectDir).toBeNull();
    expect('gmbtProjectDir' in opened.config).toBe(false);
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

    // The install is machine state and mounts under the project's own sources
    // (level-editor.md §9); it is never written into the project file.
    test('mounts the machine install as the base without touching the project file', async () => {
      const install = join(root, 'Gothic II');
      await mkdir(join(install, 'Data'), { recursive: true });
      await writeFile(join(install, 'Data', 'Textures.vdf'), 'archive');

      const result = await new ProjectConfigService().openOrMigrate(root, install);

      expect(result.project.config.assetSources).toEqual(['.']);
      expect(result.project.gothicInstallPath).toBe(install);
      expect(result.project.resolvedAssetSources)
        .toEqual([join(install, 'Data', 'Textures.vdf'), await fsPromises.realpath(root)]);
      expect(result.project.resolvedAssetRoots).toEqual([install, await fsPromises.realpath(root)]);
    });

    test('warns about a machine install that is missing or is not an install', async () => {
      const notAnInstall = join(root, 'plain');
      await mkdir(notAnInstall);

      for (const candidate of [join(root, 'gone'), notAnInstall]) {
        const result = await new ProjectConfigService().openOrMigrate(root, candidate);
        expect(result.project.gothicInstallPath).toBeNull();
        expect(result.project.warnings).toEqual([expect.objectContaining({
          code: 'gothic-install-unavailable', source: candidate,
        })]);
      }
    });

    test('keeps gmbtProjectDir across an asset-source save', async () => {
      const service = new ProjectConfigService();
      const projectFilePath = join(root, 'demo.gothicproject.json');
      await writeFile(projectFilePath, JSON.stringify({ ...(validConfig() as object), gmbtProjectDir: 'gmbt' }));

      const descriptor = await service.updateProjectPaths(projectFilePath, ['.', root]);

      expect(descriptor.config.gmbtProjectDir).toBe('gmbt');
      expect(JSON.parse(await readFile(projectFilePath, 'utf8')).gmbtProjectDir).toBe('gmbt');
    });

    test('uses a unique sibling temp file and atomic rename', async () => {
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

    test('does not clobber a pre-planted predictable temp file or symlink', async () => {
      const service = new ProjectConfigService();
      const projectFilePath = join(root, 'demo.gothicproject.json');
      const sentinelPath = join(root, 'sentinel.txt');
      const predictableTempPath = `${projectFilePath}.${process.pid}-0.tmp`;
      await writeFile(sentinelPath, 'sentinel');
      await symlink(sentinelPath, predictableTempPath);

      await service.save(projectFilePath, parseProjectFile(validConfig()));

      expect(await readFile(sentinelPath, 'utf8')).toBe('sentinel');
      expect(await readFile(predictableTempPath, 'utf8')).toBe('sentinel');
    });

    test('retries with another exclusive temp name after an EEXIST collision', async () => {
      const projectFilePath = join(root, 'demo.gothicproject.json');
      const realOpen = fsPromises.open;
      const collision: NodeJS.ErrnoException = new Error('EEXIST');
      collision.code = 'EEXIST';
      const openSpy = jest.spyOn(fsPromises, 'open')
        .mockRejectedValueOnce(collision)
        .mockImplementation((...args: unknown[]) => realOpen(...args));

      await new ProjectConfigService().save(projectFilePath, parseProjectFile(validConfig()));

      expect(openSpy).toHaveBeenCalledTimes(2);
      expect(openSpy.mock.calls[0][1]).toBe('wx');
      expect(openSpy.mock.calls[1][1]).toBe('wx');
      expect(openSpy.mock.calls[0][0]).not.toBe(openSpy.mock.calls[1][0]);
      openSpy.mockRestore();
    });

    test('preserves the old complete file and cleans up the temp file when rename fails', async () => {
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

    test('finds the install-shaped folder a project file still carries, and only that', async () => {
      const install = join(root, 'Gothic II');
      await mkdir(join(install, '_work', 'Data', 'Textures', '_compiled'), { recursive: true });
      const plain = join(root, 'plain');
      await mkdir(plain);

      expect(await findInstallShaped([plain, install])).toBe(install);
      expect(await findInstallShaped([plain, join(root, 'gone')])).toBeNull();
    });

    test('mounts a configured install once when it is also the machine install', async () => {
      const install = join(root, 'Gothic II');
      await mkdir(join(install, 'Data'), { recursive: true });
      await writeFile(join(install, 'Data', 'Textures.vdf'), 'archive');
      await writeFile(join(root, 'existing.gothicproject.json'), JSON.stringify(validConfig(['.', install])));

      const result = await new ProjectConfigService().openOrMigrate(root, install);

      expect(result.project.resolvedAssetSources)
        .toEqual([join(install, 'Data', 'Textures.vdf'), await fsPromises.realpath(root)]);
    });

    test('serializes asset updates with other project writes and preserves their non-asset fields', async () => {
      const projectFilePath = join(root, 'demo.gothicproject.json');
      await writeFile(projectFilePath, JSON.stringify(validConfig()));
      const service = new ProjectConfigService();
      const changed = parseProjectFile({ ...validConfig(), target: 'g1' });

      const [, opened] = await Promise.all([
        service.save(projectFilePath, changed),
        service.updateProjectPaths(projectFilePath, ['.', 'assets']),
      ]);

      expect(opened.config.target).toBe('g1');
      expect(opened.config.assetSources).toEqual(['.', 'assets']);
    });

    test('refuses an asset update when the project changes externally before publication', async () => {
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

      await expect(new ProjectConfigService().updateProjectPaths(projectFilePath, ['.', 'assets']))
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
      const projectFilePath = join(root, `${pathBasename(root)}.gothicproject.json`);
      const winner = validConfig(['.', 'winner-assets']);
      const service = new ProjectConfigService();
      const realLink = fsPromises.link;
      const linkSpy = jest.spyOn(fsPromises, 'link').mockImplementationOnce(async () => {
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

  // level-editor.md §16.31: a project opened from inside a GMBT tree reads the
  // `.gmbt.yml` that already names its asset folders.
  describe('GMBT detection', () => {
    const beppoYml = 'gothicRoot: gothic\n\nmodFiles:\n  assets:\n    - mdk\n    - thirdparty\n    - mod\n\n  defaultWorld: SURFACE_BEPPO.ZEN\n';

    let modRoot: string;

    beforeEach(async () => {
      modRoot = join(root, 'mod');
      await mkdir(modRoot);
      await mkdir(join(root, 'mdk'));
      await mkdir(join(root, 'thirdparty'));
      await mkdir(join(root, 'gothic', 'Data'), { recursive: true });
      await writeFile(join(root, 'gothic', 'Data', 'Textures.vdf'), 'archive');
      await writeFile(join(root, '.gmbt.yml'), beppoYml);
    });

    test('seeds a new project file with the GMBT folders and the GMBT project itself', async () => {
      const result = await new ProjectConfigService().openOrMigrate(modRoot, null);

      // GMBT's own order: the install is the base, the mod folder wins.
      expect(result.project.config.assetSources).toEqual(['../gothic', '../mdk', '../thirdparty', '.']);
      expect(result.project.config.gmbtProjectDir).toBe('..');
      expect(result.project.gmbtProjectDir).toBe(await fsPromises.realpath(root));
      expect(JSON.parse(await readFile(
        join(modRoot, 'mod.gothicproject.json'), 'utf8',
      )).gmbtProjectDir).toBe('..');
    });

    test('skips a GMBT asset folder that is the project root itself', async () => {
      const result = await new ProjectConfigService().openOrMigrate(modRoot, null);

      expect(result.project.config.assetSources).not.toContain('../mod');
    });

    test('leaves the Gothic root out when it is not shaped like an install', async () => {
      await writeFile(join(root, '.gmbt.yml'), 'gothicRoot: ..\nmodFiles:\n  assets:\n    - mdk\n');

      const result = await new ProjectConfigService().openOrMigrate(modRoot, null);

      expect(result.project.config.assetSources).toEqual(['../mdk', '.']);
    });

    test('adopts the GMBT project for an existing file that names none, and persists it', async () => {
      const projectFilePath = join(modRoot, 'demo.gothicproject.json');
      await writeFile(projectFilePath, JSON.stringify(validConfig()));

      const result = await new ProjectConfigService().openOrMigrate(modRoot, null);

      expect(result.project.gmbtProjectDir).toBe(await fsPromises.realpath(root));
      expect(JSON.parse(await readFile(projectFilePath, 'utf8')).gmbtProjectDir).toBe('..');
      // The asset list is the user's, so adoption never rewrites it.
      expect(result.project.config.assetSources).toEqual(['.']);
    });

    test('leaves an existing gmbtProjectDir alone', async () => {
      const projectFilePath = join(modRoot, 'demo.gothicproject.json');
      await mkdir(join(modRoot, 'own'));
      await writeFile(join(modRoot, 'own', '.gmbt.yml'), 'modFiles:\n  assets:\n    - .\n');
      await writeFile(projectFilePath, JSON.stringify({ ...(validConfig() as object), gmbtProjectDir: 'own' }));

      const result = await new ProjectConfigService().openOrMigrate(modRoot, null);

      expect(result.project.config.gmbtProjectDir).toBe('own');
    });

    test('offers the GMBT folders the asset list does not have yet', async () => {
      const projectFilePath = join(modRoot, 'demo.gothicproject.json');
      await writeFile(projectFilePath, JSON.stringify({
        ...(validConfig(['.', '../mdk']) as object), gmbtProjectDir: '..',
      }));

      const result = await new ProjectConfigService().openOrMigrate(modRoot, null);

      expect(result.project.gmbtAssetSources).toEqual(['../thirdparty', '../gothic']);
    });

    test('reports the source folders themselves, not the archives they expand to', async () => {
      const projectFilePath = join(modRoot, 'demo.gothicproject.json');
      await writeFile(projectFilePath, JSON.stringify(validConfig(['.', '../gothic', '../thirdparty'])));

      const { project } = await new ProjectConfigService().openOrMigrate(modRoot, null);

      expect(project.resolvedAssetRoots).toEqual([
        project.projectRoot,
        join(await fsPromises.realpath(root), 'gothic'),
        join(await fsPromises.realpath(root), 'thirdparty'),
      ]);
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
