import * as path from 'path';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';

/**
 * The asset thumbnail cache (level-editor.md §16.26 row 1) — PNGs the
 * renderer drew of mounted visuals, kept **machine-locally** under Electron's
 * `userData` and never beside the project: a thumbnail is a derived image of
 * a file the VFS holds, regenerated on demand, and nothing a collaborator
 * needs to receive.
 *
 * The key is the asset's name plus the mounts it resolves through — each
 * source's path and mtime, in mount order. The VFS answers "which file is
 * `NW_CRATE.MRM`" and nothing else, so the file's own identity is not
 * available; what is available is the list that decides it, and a rebuilt
 * VDF or a reordered list changes the key rather than serving a stale image.
 * A loose directory's mtime does not follow its nested files, which is why
 * the grid can also be told to redraw.
 *
 * Stateless beyond the directory, like `WorldFoldersService`: the mount list
 * is handed in per call by whoever knows the open world.
 *
 * Two bounds keep the folder from growing for the life of the install, since
 * nothing in the app lists or clears it: `store` only takes a key this
 * session's `keyFor` minted, and holds the directory to `MAX_CACHED_PNGS`
 * files. The key changing is the normal case — that is what a recompile does —
 * so an old key's PNG is never coming back and is the first to go.
 */
export class ThumbnailCacheService {
  private readonly dir: string;
  private readonly minted = new Set<string>();

  constructor(dir: string) {
    this.dir = dir;
  }

  async keyFor(name: string, sources: readonly string[]): Promise<string> {
    const hash = createHash('sha256');
    hash.update(name.toUpperCase());
    for (const source of sources) {
      let stamp = 'absent';
      try {
        stamp = String((await fs.stat(source)).mtimeMs);
      } catch {
        // An unreadable mount is skipped by the VFS open too; it still takes
        // its place in the key so that its arrival changes the answer.
      }
      hash.update(`\n${source}@${stamp}`);
    }
    const key = hash.digest('hex');
    this.minted.add(key);
    return key;
  }

  /** The PNG as a data URL, or null when nothing has been drawn under `key`. */
  async load(key: string): Promise<string | null> {
    assertKey(key);
    try {
      const bytes = await fs.readFile(this.fileFor(key));
      return `${PNG_DATA_URL}${bytes.toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** Atomic write, `SettingsService.writeSettings`'s temp-file-and-rename.
   *  Only a key `keyFor` answered: that is the only one a thumbnail can exist
   *  under, and the one the renderer was told to draw. */
  async store(key: string, dataUrl: string): Promise<void> {
    assertKey(key);
    if (!this.minted.has(key)) throw new Error('Invalid thumbnail key: not minted by this cache');
    const bytes = pngBytesOf(dataUrl);
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.fileFor(key);
    const tmp = `${target}.tmp`;
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, target);
    await this.prune(key);
  }

  /** Keep `keep` and the newest `MAX_CACHED_PNGS - 1` others. */
  private async prune(keep: string): Promise<void> {
    const keepFile = `${keep}.png`;
    const others = (await fs.readdir(this.dir)).filter(
      (name) => name.endsWith('.png') && name !== keepFile,
    );
    const excess = others.length + 1 - MAX_CACHED_PNGS;
    if (excess <= 0) return;
    const dated = await Promise.all(
      others.map(async (name) => ({ name, at: (await fs.stat(path.join(this.dir, name))).mtimeMs })),
    );
    dated.sort((a, b) => a.at - b.at);
    for (const { name } of dated.slice(0, excess)) {
      // A second write pruning at the same time may have taken it already.
      await fs.unlink(path.join(this.dir, name)).catch(() => undefined);
    }
  }

  private fileFor(key: string): string {
    return path.join(this.dir, `${key}.png`);
  }
}

const PNG_DATA_URL = 'data:image/png;base64,';
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const KEY = /^[0-9a-f]{64}$/;
/** 96 px tiles of a few KB each: a recompile's whole old set fits, and so does
 *  a big mod's redrawn one, at a bounded handful of MB. */
export const MAX_CACHED_PNGS = 1024;

function assertKey(key: string): void {
  if (!KEY.test(key)) throw new Error('Invalid thumbnail key');
}

/** Decode a `data:image/png;base64,` URL, refusing anything that is not one:
 *  the bytes go to disk under a `.png` name, and the renderer is the only
 *  thing that should ever have produced them. */
export function pngBytesOf(dataUrl: string): Buffer {
  if (!dataUrl.startsWith(PNG_DATA_URL)) throw new Error('Thumbnail must be a PNG data URL');
  const bytes = Buffer.from(dataUrl.slice(PNG_DATA_URL.length), 'base64');
  if (bytes.length < PNG_MAGIC.length || PNG_MAGIC.some((byte, i) => bytes[i] !== byte)) {
    throw new Error('Thumbnail must be a PNG data URL');
  }
  return bytes;
}
