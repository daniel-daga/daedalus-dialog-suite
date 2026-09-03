// Which asset sources to mount for a Gothic install.
//
// The rule is measured, not stylistic (zenkit-node README; level-editor.md §3):
// `Vfs::mount_host` memory-maps every file under a directory eagerly, and
// mounting an extracted install's `Meshes/_compiled` + `Textures/_compiled`
// (4,153 files) costs 2,170 ms against 15 ms for the four equivalent VDFs. The
// cost is per *file* and it is not ZenKit's — opening and closing those same
// files with no VFS involved costs the same. Across a whole world the two
// mounts resolve every name to the same file and decode byte-identical pixels,
// so archives are strictly the better mount when both exist.
//
// No filesystem import: `exists` is injected, which is what makes the rule
// testable without a Gothic install and keeps this package free of node
// dependencies.

/** Base names in ZenGin load order — an addon archive must follow its base. */
const ARCHIVES = [
  'Textures.vdf', 'Textures_Addon.vdf',
  'Meshes.vdf', 'Meshes_Addon.vdf',
  // .MDL/.MDM/.MDH/.MMB live here, not in Meshes. Without it every MODEL and
  // MORPH_MESH visual in a retail world is unresolvable.
  'Anims.vdf', 'Anims_Addon.vdf',
];

/** The loose fallback, for an install that has no archives at all. */
const LOOSE = ['Meshes', 'Textures', 'Anims'];

/**
 * Asset sources for `openVfs`, in mount order — later wins: the archives, then
 * any loose `_compiled` tree beside them (what a GMBT build writes), then the
 * caller's mod sources.
 *
 * @param root       the Gothic installation directory
 * @param exists     `fs.existsSync`, injected
 * @param modSources extra archives or directories, appended so a mod overrides
 *                   the retail assets. A mod tree usually has to be mounted as
 *                   a directory; it is just usually small.
 */
export function gothicAssetSources(
  root: string,
  exists: (file: string) => boolean,
  modSources: readonly string[] = [],
): string[] {
  const archives: string[] = [];
  for (const name of ARCHIVES) {
    const file = `${root}/Data/${name}`;
    // An MDK-style install renames the six VDFs so the engine reads loose files
    // instead. They stay byte-identical and perfectly mountable.
    if (exists(file)) archives.push(file);
    else if (exists(`${file}.disabled`)) archives.push(`${file}.disabled`);
  }

  // Loose trees ride *on top of* the archives rather than replacing them: an
  // install a mod is built into has both, and ZenGin reads the loose file
  // first, so the assets a GMBT build just compiled have to win. A stock
  // install has no `_work` and pays nothing for this; the 2,170 ms case is an
  // install with no archives at all, which takes the same path it always did.
  const loose = LOOSE
    .map((name) => `${root}/_work/Data/${name}/_compiled`)
    .filter(exists);

  return [...archives, ...loose, ...modSources];
}
