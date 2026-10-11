import { promises as fs } from 'node:fs';
import path from 'node:path';

// Reached past `zenkit-node`'s index deliberately: that entry loads the native
// addon, and reading an OU database is pure JS over the container walkers.
import { readOutputUnits, rewriteOutputUnits, type OutputUnitLine } from 'zenkit-node/lib/output-units.js';

import type { ProjectOutputUnits } from '../../shared/types';

/**
 * Finding and reading the project's OutputUnit database (#264).
 *
 * Subtitles do not come from the scripts at runtime — they come from `OU.BIN`,
 * which reparsing does not regenerate. The Problems rule `output-unit-stale`
 * compares the two, and this is where the file it compares against comes from.
 *
 * The database lives under the configured Gothic install, because that is where
 * GMBT compiles into. No install configured means no database, which the rule
 * reads as "nothing is known" rather than "nothing is legal".
 */
const CUTSCENE_DIR = ['_work', 'Data', 'Scripts', 'content', 'CUTSCENE'];

/** `OU.BIN` first: it is the one the engine loads. `OU.CSL` is its text twin. */
const OU_NAMES = ['OU.BIN', 'OU.CSL'];

/**
 * The cutscene folder's real path on disk. Gothic's own paths are Windows and
 * case-insensitive; a real install's casing varies (`content` vs `Content`,
 * `CUTSCENE` vs `Cutscene`), so each segment is matched case-insensitively
 * rather than assumed.
 */
async function resolveCaseInsensitive(root: string, segments: string[]): Promise<string | null> {
  let current = root;
  for (const segment of segments) {
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch {
      return null;
    }
    const match = entries.find((entry) => entry.toLowerCase() === segment.toLowerCase());
    if (match === undefined) return null;
    current = path.join(current, match);
  }
  return current;
}

/** Every OU file under `installPath`, `OU.BIN` first. */
async function findOutputUnitFiles(installPath: string | null): Promise<string[]> {
  if (installPath === null || installPath.trim() === '') return [];

  const dir = await resolveCaseInsensitive(installPath, CUTSCENE_DIR);
  if (dir === null) return [];

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  return OU_NAMES.flatMap((wanted) => {
    const match = entries.find((entry) => entry.toLowerCase() === wanted.toLowerCase());
    return match === undefined ? [] : [path.join(dir, match)];
  });
}

/**
 * Read the OU database under `installPath`, or null when there is none.
 *
 * A file that exists but cannot be read is null too, with the reason logged:
 * the Problems panel is not the place to learn that someone's OU is truncated,
 * and a scan that threw would take every other rule's findings with it.
 */
export async function readProjectOutputUnits(installPath: string | null): Promise<ProjectOutputUnits | null> {
  const [filePath] = await findOutputUnitFiles(installPath);
  if (filePath === undefined) return null;
  try {
    const { format, units } = readOutputUnits(await fs.readFile(filePath));
    return { filePath, format, units };
  } catch (error) {
    console.warn(`[outputUnits] could not read ${filePath}:`, error);
    return null;
  }
}

/**
 * Set the scripts' lines into the OU database (#264's second half) — every OU
 * file under the install, `OU.BIN` and its text twin `OU.CSL` alike, so the two
 * cannot disagree. Each is copied to `<name>.bak` before it is written, and
 * every file is rewritten in memory first, so one that will not read leaves
 * all of them untouched.
 *
 * Returns the files written and the database as it now reads, which is what the
 * Problems panel should compare against next.
 */
export async function updateProjectOutputUnits(
  installPath: string | null,
  lines: OutputUnitLine[],
): Promise<{ written: string[]; outputUnits: ProjectOutputUnits | null }> {
  if (installPath === null || installPath.trim() === '') {
    throw new Error('Set the Gothic install to update its OU database');
  }
  const files = await findOutputUnitFiles(installPath);
  if (files.length === 0) {
    throw new Error(`There is no OU database (OU.BIN or OU.CSL) under ${installPath}`);
  }

  const rewrites = await Promise.all(files.map(async (filePath) => {
    const original = await fs.readFile(filePath);
    return { filePath, original, rewritten: rewriteOutputUnits(original, lines) };
  }));
  for (const { filePath, original, rewritten } of rewrites) {
    await fs.writeFile(`${filePath}.bak`, original);
    await fs.writeFile(filePath, rewritten);
  }

  return { written: files, outputUnits: await readProjectOutputUnits(installPath) };
}
