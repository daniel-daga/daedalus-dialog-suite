import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addToCategory, assetKey, emptyAssetCatalog, mergeCatalogs, parseAssetCatalog,
  removeFromCategory, toggleFavorite, visualsOf,
} from 'zen-world';
import type { AssetCatalog } from '../../../../shared/worldTypes';
import assetCategorySeed from '../../../../shared/assetCategorySeed.json';
import { useWorldStore } from '../../../store/worldStore';
import { useProjectStore } from '../../../store/projectStore';
import { AssetThumbnails } from '../../../world/assetThumbnails';
import { ThumbnailRenderer } from '../../../world/ThumbnailRenderer';
import { LiveTilePreview } from '../../../world/LiveTilePreview';
import type { AssetCatalogProps } from '../WorldAssetBrowser';

export interface AssetCatalogSurface {
  /** The four reads the browser and the preview panel make, straight through. */
  listAssets: (assetPath: string) => ReturnType<typeof window.editorAPI.listWorldAssets>;
  searchAssets: (query: string) => ReturnType<typeof window.editorAPI.searchWorldAssets>;
  loadTexture: (name: string, maxSize: number) => ReturnType<typeof window.editorAPI.getWorldTexture>;
  loadVisual: (name: string) => ReturnType<typeof window.editorAPI.getWorldVisual>;
  /** The thumbnail queue, and null with no world open. */
  thumbnails: AssetThumbnails | null;
  /** The one live scene the grid turns a hovered tile in, and null with no world. */
  liveTile: LiveTilePreview | null;
  /**
   * What the browser is handed to draw and edit the categories, and `undefined`
   * with no project open — there is then nowhere to persist a change to, so the
   * verbs are not offered rather than being offered and dropped.
   */
  catalogProps: AssetCatalogProps | undefined;
}

/**
 * The World surface's asset side (§16.26), lifted out of `WorldSurface.tsx`
 * (`docs/plans/level-editor-review-2026-09-04.md` §4 names the asset catalogue
 * as one of the nine concerns).
 *
 * Two lifetimes meet here and neither is the surface's. The **catalogue** is the
 * project's: `<project>.assets.json`, loaded when a project is and persisted on
 * every change the way the folder sidecar is. The **renderers** are the open
 * world's: their caches key on that world's VFS mounts, so a new world means new
 * ones, and both hold a GL context that has to be given back.
 *
 * The shipped seed is merged in for display and **never written back**, so the
 * sidecar stays the project's diff against it — which is also what makes
 * `removable` answerable: an entry the sidecar itself carries can be taken out
 * again, one that only the seed carries cannot.
 */
export function useAssetCatalog(): AssetCatalogSurface {
  const projectFilePath = useProjectStore((state) => state.projectFilePath);
  /** The path rather than the summary: a refreshed index after a structural op
   *  is the same world over the same mounts, and rebuilding the renderers for it
   *  would throw away a warm cache and a GL context for nothing. */
  const worldPath = useWorldStore((state) => state.summary?.worldPath ?? null);

  const [assetCatalog, setAssetCatalog] = useState<AssetCatalog>(emptyAssetCatalog());
  useEffect(() => {
    let current = true;
    setAssetCatalog(emptyAssetCatalog());
    if (projectFilePath === null) return undefined;
    window.editorAPI.getAssetCatalog(projectFilePath)
      .then((loaded) => { if (current) setAssetCatalog(loaded); })
      .catch((failure) => { console.error('[World] Failed to read the asset catalog:', failure); });
    return () => { current = false; };
  }, [projectFilePath]);

  /** The one place that both sets the state and writes the sidecar — the same
   *  rule `useVobFolders` holds, and for the same reason: a setter that did not
   *  write would leave the file a version behind whatever is on screen. */
  const persistAssetCatalog = useCallback((next: AssetCatalog) => {
    setAssetCatalog(next);
    if (projectFilePath === null) return;
    window.editorAPI.saveAssetCatalog(projectFilePath, next).catch((failure) => {
      console.error('[World] Failed to save the asset catalog:', failure);
    });
  }, [projectFilePath]);

  const mergedAssetCatalog = useMemo(
    () => mergeCatalogs(parseAssetCatalog(assetCategorySeed), assetCatalog),
    [assetCatalog],
  );

  const catalogProps = useMemo<AssetCatalogProps | undefined>(() => (
    projectFilePath === null ? undefined : {
      catalog: mergedAssetCatalog,
      removable: (path, name) => visualsOf(assetCatalog, path).some((visual) => assetKey(visual) === assetKey(name)),
      onToggleFavorite: (name) => persistAssetCatalog(toggleFavorite(assetCatalog, name)),
      onAddToCategory: (path, name) => persistAssetCatalog(addToCategory(assetCatalog, path, name)),
      onRemoveFromCategory: (path, name) => persistAssetCatalog(removeFromCategory(assetCatalog, path, name)),
    }
  ), [projectFilePath, mergedAssetCatalog, assetCatalog, persistAssetCatalog]);

  const listAssets = useCallback(
    (assetPath: string) => window.editorAPI.listWorldAssets(assetPath),
    [],
  );

  const searchAssets = useCallback(
    (query: string) => window.editorAPI.searchWorldAssets(query),
    [],
  );

  const loadTexture = useCallback(
    (name: string, maxSize: number) => window.editorAPI.getWorldTexture(name, maxSize),
    [],
  );

  const loadVisual = useCallback(
    (name: string) => window.editorAPI.getWorldVisual(name),
    [],
  );

  // The thumbnail queue (§16.26 row 1) — one per open world, since its cache
  // keys are the open world's mounts. Built lazily: the offscreen renderer
  // holds a GL context, and a surface with no Assets tab open owes none.
  const thumbnailsRef = useRef<AssetThumbnails | null>(null);
  const thumbnails = useMemo(() => {
    thumbnailsRef.current?.dispose();
    thumbnailsRef.current = worldPath === null ? null : new AssetThumbnails({
      getThumbnail: (name) => window.editorAPI.getAssetThumbnail(name),
      putThumbnail: (key, dataUrl) => window.editorAPI.putAssetThumbnail(key, dataUrl),
      loadVisual,
      loadTexture,
      renderer: new ThumbnailRenderer(),
    });
    return thumbnailsRef.current;
  }, [worldPath, loadVisual, loadTexture]);
  useEffect(() => () => { thumbnailsRef.current?.dispose(); }, []);

  // The tile under the pointer turns (§16.26 row 1) — one live scene for the
  // whole grid, the still PNG everywhere else. Same lifetime as the queue and
  // for the same reason: its GL context and the one visual it keeps between
  // hovers belong to the open world's mounts.
  const liveTileRef = useRef<LiveTilePreview | null>(null);
  const liveTile = useMemo(() => {
    liveTileRef.current?.dispose();
    liveTileRef.current = worldPath === null ? null : new LiveTilePreview({ loadVisual, loadTexture });
    return liveTileRef.current;
  }, [worldPath, loadVisual, loadTexture]);
  useEffect(() => () => { liveTileRef.current?.dispose(); }, []);

  return { listAssets, searchAssets, loadTexture, loadVisual, thumbnails, liveTile, catalogProps };
}
