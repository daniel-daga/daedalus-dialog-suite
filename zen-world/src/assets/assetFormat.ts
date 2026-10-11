// The asset browser's format facet (#289).
//
// Florian asked to filter "by file format (3DS, TGA, ASC …)" — the source
// formats a modder works in — while the mounted namespace mostly lists what the
// asset compiler made of them (`.MRM`, `-C.TEX`, `.MDL`). A facet over raw
// extensions would offer `3DS` and find nothing in a retail install, and offer
// `MRM` to someone who has never typed it. So a group is the *kind* of asset,
// and both spellings land in it: the label says which, source first.

export type AssetFormat = 'mesh' | 'model' | 'morph' | 'texture' | 'animation' | 'other';

interface FormatGroup {
  id: AssetFormat;
  label: string;
  extensions: readonly string[];
}

const GROUPS: readonly FormatGroup[] = [
  { id: 'mesh', label: 'Meshes (3DS → MRM, MSH)', extensions: ['.3DS', '.MRM', '.MSH'] },
  { id: 'model', label: 'Models (ASC, MDS → MDL, MDM, MDH, MSB)', extensions: ['.ASC', '.MDS', '.MDL', '.MDM', '.MDH', '.MSB'] },
  { id: 'morph', label: 'Morph meshes (MMS → MMB)', extensions: ['.MMS', '.MMB'] },
  { id: 'texture', label: 'Textures (TGA → TEX)', extensions: ['.TGA', '.TEX'] },
  { id: 'animation', label: 'Animations (MAN)', extensions: ['.MAN'] },
];

/** Every group, in the order the facet offers them — the last one catching
 *  whatever the others do not (scripts, sounds, fonts, stray files). */
export const ASSET_FORMATS: readonly { id: AssetFormat; label: string }[] = [
  ...GROUPS.map(({ id, label }) => ({ id, label })),
  { id: 'other', label: 'Other files' },
];

export function assetFormat(name: string): AssetFormat {
  const bare = name.slice(name.lastIndexOf('/') + 1).toUpperCase();
  const dot = bare.lastIndexOf('.');
  if (dot < 0) return 'other';
  const extension = bare.slice(dot);
  return GROUPS.find((group) => group.extensions.includes(extension))?.id ?? 'other';
}
