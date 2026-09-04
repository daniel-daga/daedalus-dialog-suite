import * as path from 'path';
import { promises as fs } from 'fs';
import { emptyAssetCatalog, parseAssetCatalog, type AssetCatalog } from 'zen-world';

/**
 * The `<project>.assets.json` sidecar (level-editor.md §16.26, "Wanted on
 * top") — the asset browser's favorites and user categories, beside the
 * project file rather than in it or beside a world: the browser is
 * project-wide, so a world's `.folders.json` is the wrong scope, and the
 * project file is the schema every reader validates strictly. Committable
 * with the project, like `WorldFoldersService`'s sidecar is with its world.
 *
 * Holds only what the user added; the shipped seed is merged in by the
 * renderer at read time (`mergeCatalogs`). Stateless: the renderer carries
 * `projectFilePath` on every call, exactly as it carries `worldPath` for
 * folders.
 */
export class AssetCatalogService {
  /** Saves run one at a time — see `save`. */
  private queue: Promise<unknown> = Promise.resolve();

  sidecarPath(projectFilePath: string): string {
    const base = path.basename(projectFilePath).replace(/\.gothicproject\.json$/i, '');
    return path.join(path.dirname(projectFilePath), `${base}.assets.json`);
  }

  async load(projectFilePath: string): Promise<AssetCatalog> {
    const target = this.sidecarPath(projectFilePath);
    let data: string;
    try {
      data = await fs.readFile(target, 'utf8');
    } catch {
      return emptyAssetCatalog();
    }
    try {
      return parseAssetCatalog(JSON.parse(data));
    } catch (error) {
      const corruptPath = `${target}.corrupt-${Date.now()}`;
      try {
        await fs.rename(target, corruptPath);
        console.error(`Asset catalog file was corrupt. Preserved at ${corruptPath}; falling back to empty.`, error);
      } catch (renameError) {
        console.error('Asset catalog file was corrupt and preserving it failed; falling back to empty.', error, renameError);
      }
      return emptyAssetCatalog();
    }
  }

  /** `WorldFoldersService.save`'s temp-file-and-rename. */
  async save(projectFilePath: string, catalog: AssetCatalog): Promise<void> {
    // Serialized, exactly as `WorldFoldersService.save` is and for the same
    // reason: the renderer fires one save per change and awaits none of them
    // (`WorldSurface`'s `persistCatalog`), and two in flight over one fixed
    // `<target>.tmp` tear the sidecar between them.
    const run = this.queue.then(() => this.write(projectFilePath, catalog),
      () => this.write(projectFilePath, catalog));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(projectFilePath: string, catalog: AssetCatalog): Promise<void> {
    const target = this.sidecarPath(projectFilePath);
    const tmpPath = `${target}.tmp`;
    const handle = await fs.open(tmpPath, 'w');
    try {
      await handle.writeFile(JSON.stringify(catalog, null, 2));
      try {
        await handle.sync();
      } catch {
        // Best-effort durability.
      }
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, target);
  }
}
