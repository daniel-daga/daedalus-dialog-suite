import type { VfsEntry } from '../../shared/worldTypes';

export interface NpcAssetSuggestions {
  headMeshes: string[];
  walkOverlays: string[];
}

const sortedUnique = (names: string[]): string[] => {
  const unique = new Map<string, string>();
  for (const name of names) {
    const key = name.toUpperCase();
    if (!unique.has(key)) unique.set(key, name);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

/** Pick the NPC form's head meshes and human walk overlays out of bounded VFS searches. */
export function npcAssetSuggestions(headEntries: readonly VfsEntry[], overlayEntries: readonly VfsEntry[]): NpcAssetSuggestions {
  const headMeshes = headEntries
    .filter((entry) => entry.type === 'file' && /^HUM_HEAD_.+\.MMB$/i.test(entry.name))
    .map((entry) => entry.name.replace(/\.MMB$/i, ''));
  const walkOverlays = overlayEntries
    .filter((entry) => entry.type === 'file' && /^HUMANS_.+\.MDS$/i.test(entry.name))
    .map((entry) => entry.name);
  return { headMeshes: sortedUnique(headMeshes), walkOverlays: sortedUnique(walkOverlays) };
}
