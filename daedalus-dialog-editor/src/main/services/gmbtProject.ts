import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Reading Daniel's own GMBT project (level-editor.md §16.31). A `.gmbt.yml`
 * already names the mod's asset folders, its Gothic root and its default
 * world, so a project opened from inside a GMBT tree can configure itself
 * instead of asking for the same folders a second time.
 *
 * The reader is a deliberate subset, not a YAML parser: three keys out of a
 * file GMBT writes by hand, so a dependency for it would be the larger change.
 * Anything it does not understand is skipped rather than rejected — a `.gmbt.yml`
 * belongs to GMBT, and this app is not the one that gets to call it invalid.
 */
export interface GmbtYml {
  /** `gothicRoot`, verbatim but with Windows separators normalized. */
  gothicRoot: string | null;
  /** `modFiles.assets`, in the file's own mount order — later wins, as here. */
  assets: string[];
  /** `modFiles.defaultWorld` — a bare `.ZEN` filename, not a path. */
  defaultWorld: string | null;
}

export interface GmbtProject {
  /** The folder holding the `.gmbt.yml`, which is `gmbt`'s working directory. */
  dir: string;
  /** `gothicRoot` resolved against `dir`, or null when the file names none. */
  gothicRoot: string | null;
  /** The asset folders that exist on disk, resolved and in mount order. */
  assetDirs: string[];
  defaultWorld: string | null;
}

const GMBT_CONFIG = '.gmbt.yml';
const DEFAULT_LEVELS = 4;

/** Strips a trailing `# comment`, then surrounding quotes. */
function scalar(raw: string): string {
  const value = raw.trim();
  const quote = value.slice(0, 1);
  if (quote === '"' || quote === "'") {
    const closing = value.indexOf(quote, 1);
    if (closing > 0) return value.slice(1, closing);
  }
  const comment = value.indexOf('#');
  return (comment >= 0 ? value.slice(0, comment) : value).trim();
}

/** GMBT is Windows-only, so its paths are; resolving them here is not. */
function portable(value: string): string {
  return value.replace(/\\\\/g, '\\').replace(/\\/g, '/');
}

export function readGmbtYml(text: string): GmbtYml {
  const result: GmbtYml = { gothicRoot: null, assets: [], defaultWorld: null };
  // `modFiles` is the only block read, so a `modVdf` that repeats the same key
  // names below it is skipped rather than mistaken for a second declaration.
  let inModFiles = false;
  let inAssets = false;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0 || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent === 0) {
      inModFiles = trimmed.startsWith('modFiles:');
      inAssets = false;
      const root = /^gothicRoot\s*:(.*)$/.exec(trimmed);
      if (root) result.gothicRoot = portable(scalar(root[1])) || null;
      continue;
    }
    if (!inModFiles) continue;

    if (trimmed.startsWith('- ')) {
      if (inAssets) result.assets.push(portable(scalar(trimmed.slice(2))));
      continue;
    }
    inAssets = false;
    if (/^assets\s*:\s*$/.test(trimmed)) inAssets = true;
    const world = /^defaultWorld\s*:(.*)$/.exec(trimmed);
    if (world) result.defaultWorld = scalar(world[1]) || null;
  }
  return result;
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The nearest ancestor of `startDir` (itself included) holding a `.gmbt.yml`,
 * within `levels` steps up. Asset folders the file names but the disk does not
 * have are dropped — GMBT tolerates them, and an unavailable asset source is
 * a warning nobody needs to see for a folder the project never had.
 */
export async function findGmbtProject(
  startDir: string,
  levels: number = DEFAULT_LEVELS,
): Promise<GmbtProject | null> {
  let dir = path.resolve(startDir);
  for (let step = 0; step <= levels; step++) {
    const config = path.join(dir, GMBT_CONFIG);
    let text: string | null = null;
    try {
      text = await fs.readFile(config, 'utf8');
    } catch {
      // Not this folder's; climb.
    }
    if (text !== null) {
      const parsed = readGmbtYml(text);
      const assetDirs: string[] = [];
      for (const asset of parsed.assets) {
        const resolved = path.resolve(dir, asset);
        if (await isDirectory(resolved)) assetDirs.push(resolved);
      }
      return {
        dir,
        gothicRoot: parsed.gothicRoot === null ? null : path.resolve(dir, parsed.gothicRoot),
        assetDirs,
        defaultWorld: parsed.defaultWorld,
      };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** The detected project's `defaultWorld`, re-read at the moment it is needed. */
export async function readGmbtDefaultWorld(gmbtProjectDir: string): Promise<string | null> {
  try {
    return readGmbtYml(await fs.readFile(path.join(gmbtProjectDir, GMBT_CONFIG), 'utf8')).defaultWorld;
  } catch {
    return null;
  }
}
