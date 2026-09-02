import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  discoverProjectFile,
  parseProjectFile,
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
  ])('rejects %s with a field-specific error', (_name, value, error) => {
    expect(() => parseProjectFile(value)).toThrow(error as RegExp);
  });

  test('rejects invalid world fields precisely', () => {
    expect(() => parseProjectFile({ ...validConfig(), worlds: [{ name: 'x', parts: [{ path: 1, role: 'main' }] }] }))
      .toThrow(/worlds\[0\]\.parts\[0\]\.path/i);
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
});

// Compile-time assertion that parsing exposes the shared contract.
const _config: GothicProjectFileV1 = parseProjectFile(validConfig());
void _config;
