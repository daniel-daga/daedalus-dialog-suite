// Which asset sources to mount for a Gothic install (zenkit-node README,
// level-editor.md §3 "the load path"). This is a measured rule, not a
// preference: mounting an extracted install's loose `Meshes/_compiled` +
// `Textures/_compiled` (4,153 files) costs 2,170 ms against 15 ms for the four
// equivalent VDFs, because `Vfs::mount_host` memory-maps every file eagerly and
// a file open costs ~500 µs on this machine whoever does it. Both mounts
// resolve every name to the same file and decode byte-identical pixels.

import { gothicAssetSources } from '../src/assets';

/** `exists` is injected so the rule is testable without a Gothic install. */
function installWith(files: string[]) {
  const set = new Set(files.map((f) => f.replace(/\\/g, '/').toUpperCase()));
  return (file: string) => set.has(file.replace(/\\/g, '/').toUpperCase());
}

const ROOT = 'C:/Gothic II';

const ALL_ARCHIVES = [
  `${ROOT}/Data/Textures.vdf`, `${ROOT}/Data/Textures_Addon.vdf`,
  `${ROOT}/Data/Meshes.vdf`, `${ROOT}/Data/Meshes_Addon.vdf`,
  `${ROOT}/Data/Anims.vdf`, `${ROOT}/Data/Anims_Addon.vdf`,
];

describe('zen-world/assets — gothicAssetSources', () => {
  test('mounts the archives when they are there', () => {
    expect(gothicAssetSources(ROOT, installWith(ALL_ARCHIVES))).toEqual(ALL_ARCHIVES);
  });

  test('finds the archives parked as .disabled by an MDK-style install', () => {
    // The MDK layout renames the six VDFs so the engine reads loose files
    // instead. They are byte-identical and still perfectly mountable — and on
    // this machine that install is exactly the one where the loose trees are
    // 2.2 s. Refusing to look at them would pick the slow path on the only
    // install we develop against.
    const parked = ALL_ARCHIVES.map((a) => `${a}.disabled`);
    expect(gothicAssetSources(ROOT, installWith(parked))).toEqual(parked);
  });

  test('Anims is mounted, because that is where the compiled models live', () => {
    // .MDL/.MDM/.MDH/.MMB are in Anims.vdf, not Meshes. Without it every MODEL
    // and MORPH_MESH visual in the world is unresolvable — which is what made
    // 53 of NewWorld's 63 MODEL visuals look like a name-mapping bug.
    const sources = gothicAssetSources(ROOT, installWith(ALL_ARCHIVES));
    expect(sources.some((s) => /Anims\.vdf$/i.test(s))).toBe(true);
  });

  test('an addon archive is mounted after its base, so the addon wins', () => {
    // openVfs mounts in order and later wins — ZenGin's own load order.
    const sources = gothicAssetSources(ROOT, installWith(ALL_ARCHIVES));
    for (const name of ['Textures', 'Meshes', 'Anims']) {
      const base = sources.findIndex((s) => s.endsWith(`${name}.vdf`));
      const addon = sources.findIndex((s) => s.endsWith(`${name}_Addon.vdf`));
      expect(base).toBeGreaterThanOrEqual(0);
      expect(addon).toBeGreaterThan(base);
    }
  });

  test('falls back to the loose compiled trees when no archive exists', () => {
    const loose = [`${ROOT}/_work/Data/Meshes/_compiled`, `${ROOT}/_work/Data/Textures/_compiled`,
      `${ROOT}/_work/Data/Anims/_compiled`];
    expect(gothicAssetSources(ROOT, installWith(loose))).toEqual(loose);
  });

  test('a partly-archived install still prefers every archive it has', () => {
    const some = [`${ROOT}/Data/Meshes.vdf`, `${ROOT}/Data/Textures.vdf`];
    expect(gothicAssetSources(ROOT, installWith(some))).toEqual(
      [`${ROOT}/Data/Textures.vdf`, `${ROOT}/Data/Meshes.vdf`],
    );
  });

  test('an install with neither archives nor loose trees yields nothing, not a guess', () => {
    expect(gothicAssetSources(ROOT, () => false)).toEqual([]);
  });

  test('mod sources are appended last, so a mod overrides the retail assets', () => {
    const mod = 'C:/MyMod/Data/mod.vdf';
    const sources = gothicAssetSources(ROOT, installWith([...ALL_ARCHIVES, mod]), [mod]);
    expect(sources[sources.length - 1]).toBe(mod);
    expect(sources.slice(0, -1)).toEqual(ALL_ARCHIVES);
  });
});
