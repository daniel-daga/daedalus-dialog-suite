import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { discoverWorlds } from '../src/main/services/worldDiscovery';

/** World detection off the asset sources (level-editor.md §16.31, §16.28 item 3). */
describe('discoverWorlds', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'world-discovery-'));
  });

  const worldAt = async (...segments: string[]) => {
    const file = join(root, ...segments);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'ZenGin Archive');
    return file;
  };

  test('finds worlds in a mod folder`s Worlds and in an install`s _work tree', async () => {
    const mod = await worldAt('thirdparty', 'Worlds', 'SURFACE_BEPPO.ZEN');
    const install = await worldAt('gothic', '_work', 'Data', 'Worlds', 'NEWWORLD.ZEN');

    const found = await discoverWorlds([join(root, 'thirdparty'), join(root, 'gothic')]);

    expect(found.map((world) => world.path)).toEqual([install, mod]);
    expect(found.map((world) => world.name)).toEqual(['NEWWORLD.ZEN', 'SURFACE_BEPPO.ZEN']);
    expect(found[1].source).toBe(join(root, 'thirdparty'));
  });

  test('descends into world sub-folders and ignores anything that is not a .zen', async () => {
    const nested = await worldAt('mod', 'Worlds', 'Addon', 'DRAGONISLAND.ZEN');
    await worldAt('mod', 'Worlds', 'notes.txt');

    expect((await discoverWorlds([join(root, 'mod')])).map((world) => world.path)).toEqual([nested]);
  });

  test('lets a later source win the same world name, as the mount order does', async () => {
    await worldAt('retail', 'Worlds', 'SURFACE.ZEN');
    const override = await worldAt('mod', 'Worlds', 'surface.zen');

    const found = await discoverWorlds([join(root, 'retail'), join(root, 'mod')]);

    expect(found).toHaveLength(1);
    expect(found[0].path).toBe(override);
  });

  test('takes loose .zen files sitting in the source folder itself', async () => {
    const loose = await worldAt('worlds-only', 'OLDWORLD.ZEN');

    expect((await discoverWorlds([join(root, 'worlds-only')]))[0].path).toBe(loose);
  });

  test('marks the GMBT default world, whatever its casing', async () => {
    await worldAt('mod', 'Worlds', 'OTHER.ZEN');
    await worldAt('mod', 'Worlds', 'SURFACE_BEPPO.ZEN');

    const found = await discoverWorlds([join(root, 'mod')], 'surface_beppo.zen');

    expect(found.filter((world) => world.isDefault).map((world) => world.name))
      .toEqual(['SURFACE_BEPPO.ZEN']);
  });

  test('is empty, not an error, for a source that has no worlds at all', async () => {
    await mkdir(join(root, 'textures'));
    expect(await discoverWorlds([join(root, 'textures'), join(root, 'gone')])).toEqual([]);
  });
});
