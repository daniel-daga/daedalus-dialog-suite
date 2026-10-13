// What the asset browser lists by default (#399).
//
// Florian asked for the browser to hold the source files — `.TGA`, `.3DS`,
// `.ASC` — and for everything else to wait behind a filter: a mounted install
// carries scripts, sounds and fonts by the thousand, and a `.MDL` places
// nothing anyway, because a VOB names its source and no compiled model has a
// single one. Retail installs list only what the asset compiler made of the
// sources, so the default listing is empty there — accepted: normal work is
// in source files, and compiled assets are one filter setting away.

/** The source formats a modder works in. `.MDS` included: a model script is a
 *  source file too, and a MOB is placed under its name. */
const SOURCE_EXTENSIONS = ['.3DS', '.ASC', '.MDS', '.MMS', '.TGA'];

/** What the asset compiler makes of them — what a retail install mounts. */
const COMPILED_EXTENSIONS = ['.MRM', '.MSH', '.MDL', '.MDM', '.MDH', '.MSB', '.MMB', '.TEX'];

const fileName = (name: string) => name.slice(name.lastIndexOf('/') + 1).toUpperCase();

/** Whether `name` is a source asset file — what the browser lists by default
 *  (#399), and what a VOB's `visual` names. */
export function isSourceAssetFile(name: string): boolean {
  const upper = fileName(name);
  return SOURCE_EXTENSIONS.some((extension) => upper.endsWith(extension));
}

/** Whether `name` is a compiled asset — hidden by default (#399) and shown
 *  by the browser's "compiled" filter setting. Scripts, sounds, fonts and
 *  the rest are neither and wait for "all files". */
export function isCompiledAsset(name: string): boolean {
  const upper = fileName(name);
  return COMPILED_EXTENSIONS.some((extension) => upper.endsWith(extension));
}
