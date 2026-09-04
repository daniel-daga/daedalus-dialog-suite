import * as path from 'path';
import { promises as fs } from 'fs';
import { emptyVobFolders, parseVobFolders, type VobFolders } from 'zen-world';

/**
 * The `<worldname>.folders.json` sidecar (VOB folders slice) — user-created,
 * editor-only VOB groupings, kept beside the world file they describe rather
 * than in the world itself (folders are never VOBs; see `zen-world`'s
 * `vobFolders.ts`).
 *
 * Stateless by design: the renderer already holds `WorldSummary.worldPath`
 * from the moment a world is opened, so every call carries it explicitly —
 * the same shape `world:save`'s `targetPath` already takes — instead of this
 * service keeping a second `worldPath`-keyed cache that `WorldService`'s own
 * open/close/timeout/death lifecycle would then have to keep in step with.
 * There is no cache here, so there is nothing to go stale.
 */
export class WorldFoldersService {
  /** Saves run one at a time — see `save`. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Exposed so callers (`main.ts`) can validate the exact path this service
   *  is about to touch, the same way `world:open`/`world:save` validate their
   *  own target rather than the directory it happens to live in. */
  sidecarPath(worldPath: string): string {
    const base = path.basename(worldPath, path.extname(worldPath));
    return path.join(path.dirname(worldPath), `${base}.folders.json`);
  }

  async load(worldPath: string): Promise<VobFolders> {
    const target = this.sidecarPath(worldPath);
    let data: string;
    try {
      data = await fs.readFile(target, 'utf8');
    } catch {
      // No sidecar yet — a world with no folders is the default, not an error.
      return emptyVobFolders();
    }
    try {
      return parseVobFolders(JSON.parse(data));
    } catch (error) {
      // Preserved as evidence before falling back, the same way
      // `SettingsService.readSettings` treats its own corrupt file.
      const corruptPath = `${target}.corrupt-${Date.now()}`;
      try {
        await fs.rename(target, corruptPath);
        console.error(
          `VOB folders file was corrupt and could not be parsed. Preserved at ${corruptPath}; falling back to no folders.`,
          error,
        );
      } catch (renameError) {
        console.error(
          'VOB folders file was corrupt and could not be parsed, and preserving it failed; falling back to no folders.',
          error, renameError,
        );
      }
      return emptyVobFolders();
    }
  }

  /**
   * Atomic write: serialize to a sibling temp file, best-effort fsync, then
   * rename over the real file — `SettingsService.writeSettings`'s pattern,
   * for the same reason: a crash/ENOSPC mid-write leaves the previous sidecar
   * intact rather than a torn file.
   */
  async save(worldPath: string, folders: VobFolders): Promise<void> {
    // Serialized, because the renderer fires one save per folder mutation and
    // awaits none of them. Two in flight over one fixed `<target>.tmp` name and
    // the second `open` truncates the first's temp file, the first `rename`
    // moves a partial file into place, and the second fails ENOENT — leaving a
    // torn sidecar that `load` renames aside as corrupt, so the user's folders
    // come back empty. `SettingsService` has the same queue for the same
    // reason. `then(run, run)`: a failed save is no reason to stop taking them.
    const run = this.queue.then(() => this.write(worldPath, folders),
      () => this.write(worldPath, folders));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(worldPath: string, folders: VobFolders): Promise<void> {
    const target = this.sidecarPath(worldPath);
    const tmpPath = `${target}.tmp`;
    const data = JSON.stringify(folders, null, 2);
    const handle = await fs.open(tmpPath, 'w');
    try {
      await handle.writeFile(data);
      try {
        await handle.sync();
      } catch {
        // Best-effort durability; not fatal if the platform rejects it.
      }
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, target);
  }
}
