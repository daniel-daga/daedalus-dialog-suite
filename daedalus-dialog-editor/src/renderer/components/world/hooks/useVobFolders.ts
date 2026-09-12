import { useCallback, useState } from 'react';
import {
  addVobsToFolder,
  createFolder,
  deleteFolder,
  emptyVobFolders,
  removeVobFromFolder,
  renameFolder,
  vobIndexPath,
  type VobFolders,
} from 'zen-world';
import { useWorldStore } from '../../../store/worldStore';
import { vobModelOf } from '../../../world/vobModel';

export interface VobFoldersState {
  vobFolders: VobFolders;
  /** The open path: a world's folders come off disk wholesale, and re-writing
   *  what was just read is a round trip for nothing. */
  setVobFolders: (folders: VobFolders) => void;
  addSelectionToFolder: (id: string) => void;
  /** The Folders tab's own create button: an empty folder whatever is
   *  selected, unlike the context menu's `createFolderWithSelection`. */
  createEmptyFolder: (name: string) => void;
  createFolderWithSelection: (name: string) => void;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  removeVobFromFolder: (id: string, vobPath: string) => void;
}

/**
 * User-created VOB folders (VOB folders slice) — a virtual grouping kept
 * beside the world file, never a `WorldOp`. `persistFolders` is the one
 * place state is set and the sidecar written; every mutation below goes
 * through it rather than calling `setVobFolders`/`saveVobFolders` itself.
 *
 * The save is fire-and-forget: folders are low-stakes editor metadata, not
 * the world itself, so a failed write is logged rather than surfaced the
 * way a refused world edit is.
 *
 * Read fresh on every open; a fresh open's default is no folders, the same as
 * `waynet`'s null.
 */
export function useVobFolders(): VobFoldersState {
  const [vobFolders, setVobFolders] = useState<VobFolders>(emptyVobFolders());

  const persistFolders = useCallback((next: VobFolders) => {
    setVobFolders(next);
    const worldPath = useWorldStore.getState().summary?.worldPath;
    if (worldPath === undefined) return;
    window.editorAPI.saveVobFolders(worldPath, next).catch((failure) => {
      console.error('[World] Failed to save VOB folders:', failure);
    });
  }, []);

  /** The selection's `vobIndexPath` addresses — what a folder actually
   *  stores. A VOB with no summary to resolve it against contributes nothing,
   *  the same "drop rather than guess" rule `vobIndexPath` itself follows. */
  const selectionPaths = useCallback((): string[] => {
    const { summary: current, selection: selected } = useWorldStore.getState();
    if (current === null) return [];
    const { reader } = vobModelOf(current);
    return selected
      .map((vob) => vobIndexPath(reader, vob))
      .filter((path): path is string => path !== null);
  }, []);

  const addSelectionToFolder = useCallback((id: string) => {
    const paths = selectionPaths();
    if (paths.length === 0) return;
    persistFolders(addVobsToFolder(vobFolders, id, paths));
  }, [selectionPaths, persistFolders, vobFolders]);

  const createEmptyFolder = useCallback((name: string) => {
    persistFolders(createFolder(vobFolders, crypto.randomUUID(), name));
  }, [persistFolders, vobFolders]);

  const createFolderWithSelection = useCallback((name: string) => {
    const id = crypto.randomUUID();
    const paths = selectionPaths();
    const withFolder = createFolder(vobFolders, id, name);
    persistFolders(paths.length === 0 ? withFolder : addVobsToFolder(withFolder, id, paths));
  }, [selectionPaths, persistFolders, vobFolders]);

  const renameFolderHandler = useCallback((id: string, name: string) => {
    persistFolders(renameFolder(vobFolders, id, name));
  }, [persistFolders, vobFolders]);

  const deleteFolderHandler = useCallback((id: string) => {
    persistFolders(deleteFolder(vobFolders, id));
  }, [persistFolders, vobFolders]);

  const removeVobFromFolderHandler = useCallback((id: string, vobPath: string) => {
    persistFolders(removeVobFromFolder(vobFolders, id, vobPath));
  }, [persistFolders, vobFolders]);

  return {
    vobFolders,
    setVobFolders,
    addSelectionToFolder,
    createEmptyFolder,
    createFolderWithSelection,
    renameFolder: renameFolderHandler,
    deleteFolder: deleteFolderHandler,
    removeVobFromFolder: removeVobFromFolderHandler,
  };
}
