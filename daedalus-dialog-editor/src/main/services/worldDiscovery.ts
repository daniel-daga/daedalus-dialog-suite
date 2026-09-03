import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { DiscoveredWorld } from '../../shared/worldTypes';

export type { DiscoveredWorld };

/** Where ZenGin content keeps worlds, relative to an asset source. */
const WORLD_FOLDERS = ['', 'Worlds', path.join('_work', 'Data', 'Worlds')];
const MAX_DEPTH = 3;

async function collectZenFiles(dir: string, depth: number, into: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // A source folder need not have worlds in it.
  }
  for (const entry of entries) {
    const candidate = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) await collectZenFiles(candidate, depth - 1, into);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zen')) {
      into.push(candidate);
    }
  }
}

/**
 * Worlds off the project's own asset sources (level-editor.md §16.31, and
 * §16.28 item 3): the list the World surface offers instead of a native file
 * dialog seeded from one install path.
 *
 * Loose `.zen` files only. A world still packed inside `Worlds.vdf` is not
 * found here — the VFS could name it, but nothing downstream can open a world
 * that has no filesystem path, so listing it would be an entry that fails on
 * click. Browsing for a file by hand stays beside the list for everything this
 * does not reach.
 */
export async function discoverWorlds(
  assetRoots: readonly string[],
  defaultWorld: string | null = null,
): Promise<DiscoveredWorld[]> {
  // Keyed by name, because that is what the VFS overlays on: a later source
  // holding the same world name is the one the engine would load.
  const byName = new Map<string, DiscoveredWorld>();
  for (const source of assetRoots) {
    for (const folder of WORLD_FOLDERS) {
      const files: string[] = [];
      // The source folder itself is not descended into: a mod tree's Meshes and
      // Textures are large, and a `.zen` never sits under them.
      await collectZenFiles(path.join(source, folder), folder === '' ? 0 : MAX_DEPTH, files);
      for (const file of files) {
        const name = path.basename(file);
        byName.set(name.toUpperCase(), {
          path: file,
          name,
          source,
          isDefault: defaultWorld !== null && name.toUpperCase() === defaultWorld.toUpperCase(),
        });
      }
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
