import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { findGmbtProject, readGmbtYml } from '../src/main/services/gmbtProject';

/**
 * Detecting Daniel's own GMBT project (level-editor.md §16.31) — the `.gmbt.yml`
 * beside the mod folder already says where the assets are.
 */
const BEPPO_YML = `projectName: The Legacy of Beppo

gothicRoot: ..\\..

modFiles:
  assets:
    - mdk
    - thirdparty
    - mod

  defaultWorld: SURFACE_BEPPO.ZEN

modVdf:
  output:  ..\\..\\Data\\ModVDF\\BEPPO.mod
  comment: Gothic 2 - The Legacy of Beppo

gothicIniOverrides:
  - 'GAME.playLogoVideos' : '0'
  - 'SKY_OUTDOOR.zSkyDome' : '1'`;

describe('readGmbtYml', () => {
  test('reads the asset folders, the Gothic root and the default world', () => {
    expect(readGmbtYml(BEPPO_YML)).toEqual({
      gothicRoot: '../..',
      assets: ['mdk', 'thirdparty', 'mod'],
      defaultWorld: 'SURFACE_BEPPO.ZEN',
    });
  });

  test('ignores comments, quotes and a `modVdf` block that repeats the keys', () => {
    expect(readGmbtYml([
      '# a comment',
      'gothicRoot: "C:\\\\Games\\\\Gothic II"',
      'modFiles:',
      '  assets:',
      "    - 'mod'   # trailing comment",
      'modVdf:',
      '  assets:',
      '    - never',
      '  defaultWorld: NEVER.ZEN',
    ].join('\n'))).toEqual({
      gothicRoot: 'C:/Games/Gothic II',
      assets: ['mod'],
      defaultWorld: null,
    });
  });

  test('is empty for a file that declares none of it', () => {
    expect(readGmbtYml('projectName: Nothing\n')).toEqual({
      gothicRoot: null, assets: [], defaultWorld: null,
    });
  });
});

describe('findGmbtProject', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gmbt-detect-'));
  });

  test('walks up from the project folder to the `.gmbt.yml` and resolves its paths', async () => {
    await mkdir(join(root, 'mod'), { recursive: true });
    await mkdir(join(root, 'mdk'), { recursive: true });
    await mkdir(join(root, 'thirdparty'), { recursive: true });
    await writeFile(join(root, '.gmbt.yml'), BEPPO_YML);

    const found = await findGmbtProject(join(root, 'mod'));
    expect(found).not.toBeNull();
    expect(found!.dir).toBe(root);
    expect(found!.assetDirs).toEqual([
      join(root, 'mdk'), join(root, 'thirdparty'), join(root, 'mod'),
    ]);
    expect(found!.defaultWorld).toBe('SURFACE_BEPPO.ZEN');
    expect(found!.gothicRoot).toBe(join(root, '..', '..'));
  });

  test('drops an asset folder the file names but the disk does not have', async () => {
    await mkdir(join(root, 'mod'), { recursive: true });
    await writeFile(join(root, '.gmbt.yml'), 'modFiles:\n  assets:\n    - mod\n    - gone\n');

    const found = await findGmbtProject(join(root, 'mod'));
    expect(found!.assetDirs).toEqual([join(root, 'mod')]);
  });

  test('is null when no ancestor within reach holds a `.gmbt.yml`', async () => {
    const deep = join(root, 'a', 'b');
    await mkdir(deep, { recursive: true });
    expect(await findGmbtProject(deep)).toBeNull();
  });

  test('stops climbing after the configured number of levels', async () => {
    const deep = join(root, 'a', 'b', 'c', 'd', 'e');
    await mkdir(deep, { recursive: true });
    await writeFile(join(root, '.gmbt.yml'), 'modFiles:\n  assets:\n    - a\n');
    expect(await findGmbtProject(deep, 2)).toBeNull();
    expect(await findGmbtProject(deep, 5)).not.toBeNull();
  });
});
