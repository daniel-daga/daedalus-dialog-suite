/**
 * The `<project>.assets.json` sidecar (level-editor.md §16.26, "Wanted on
 * top"): favorites and categories on the asset browser, kept beside the
 * project file — asset-browser-wide, so not a section of a world's
 * `.folders.json` — and committable with it.
 *
 * @jest-environment node
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { AssetCatalogService } from '../src/main/services/AssetCatalogService';

describe('AssetCatalogService', () => {
  const testDir = path.resolve('./test-asset-catalog');
  const projectFilePath = path.join(testDir, 'mymod.gothicproject.json');
  const sidecarPath = path.join(testDir, 'mymod.assets.json');
  let service: AssetCatalogService;

  beforeEach(async () => {
    service = new AssetCatalogService();
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('names the sidecar after the project file, beside it', () => {
    expect(service.sidecarPath(projectFilePath)).toBe(sidecarPath);
  });

  it('loads the empty catalogue when no sidecar exists yet', async () => {
    await expect(service.load(projectFilePath)).resolves.toEqual({ favorites: [], categories: [] });
  });

  it('round-trips what it saves', async () => {
    const catalog = { favorites: ['NW_CRATE.MRM'], categories: [{ path: 'Mine/Crates', visuals: ['NW_CRATE.MRM'] }] };
    await service.save(projectFilePath, catalog);
    await expect(service.load(projectFilePath)).resolves.toEqual(catalog);
    await expect(fs.readFile(sidecarPath, 'utf8')).resolves.toContain('"Mine/Crates"');
  });

  it('preserves a corrupt sidecar aside and falls back to empty', async () => {
    await fs.writeFile(sidecarPath, '{ not json');
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(service.load(projectFilePath)).resolves.toEqual({ favorites: [], categories: [] });
    const entries = await fs.readdir(testDir);
    expect(entries.some((entry) => entry.startsWith('mymod.assets.json.corrupt-'))).toBe(true);
    error.mockRestore();
  });
});
