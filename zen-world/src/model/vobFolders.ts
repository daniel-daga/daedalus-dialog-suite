// User-created VOB folders (level-editor.md, VOB folders slice) — a purely
// editor-side grouping, additional to the real scene tree in `vobTree.ts`.
//
// A folder is never a VOB. It never touches `parent`/`childIndex`, never goes
// through `applyOps`, and has no engine-side existence — filing a VOB into one
// is bookkeeping, not a `ReparentVob`. That is also why membership is kept out
// of `WorldOp`'s history entirely: there is nothing here for undo/redo to
// replay.
//
// Membership is addressed by `vobIndexPath` (`ops.ts`), the same "native
// address" `AddVob`/`ReparentVob`/`DeleteVob` already use, rather than by the
// flat VOB index every structural op renumbers. It is not immune to going
// stale — a VOB deleted, or moved by a `ReparentVob`, changes or removes its
// own path — but `resolveFolderMembers` answers that the same way the scene
// tree answers a stale selection: the entry is dropped, not remapped to
// whatever now sits at that path.

import { vobAtIndexPath } from './ops';
import type { VobReader } from './vobTree';

export interface VobFolder {
  /** Caller-supplied (`crypto.randomUUID()` at the call site — this module
   *  stays pure and mints nothing itself). Not derived from the name, so a
   *  rename never has to re-key anything that references the folder. */
  id: string;
  name: string;
  /** `vobIndexPath` addresses. Order is display order. */
  vobPaths: string[];
}

export interface VobFolders {
  /** Order is display order. */
  folders: VobFolder[];
}

export function emptyVobFolders(): VobFolders {
  return { folders: [] };
}

export function createFolder(state: VobFolders, id: string, name: string): VobFolders {
  return { folders: [...state.folders, { id, name, vobPaths: [] }] };
}

export function renameFolder(state: VobFolders, id: string, name: string): VobFolders {
  return {
    folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name } : folder)),
  };
}

export function deleteFolder(state: VobFolders, id: string): VobFolders {
  return { folders: state.folders.filter((folder) => folder.id !== id) };
}

/** Idempotent — a path already in the folder is not added twice. */
export function addVobsToFolder(state: VobFolders, id: string, vobPaths: readonly string[]): VobFolders {
  return {
    folders: state.folders.map((folder) => {
      if (folder.id !== id) return folder;
      const existing = new Set(folder.vobPaths);
      const added = vobPaths.filter((path) => !existing.has(path));
      return added.length === 0 ? folder : { ...folder, vobPaths: [...folder.vobPaths, ...added] };
    }),
  };
}

export function removeVobFromFolder(state: VobFolders, id: string, vobPath: string): VobFolders {
  return {
    folders: state.folders.map((folder) => (
      folder.id === id
        ? { ...folder, vobPaths: folder.vobPaths.filter((path) => path !== vobPath) }
        : folder
    )),
  };
}

/**
 * A folder's members as flat VOB indices, against the world `reader` currently
 * holds — the inverse of the addresses `vobPaths` stores.
 *
 * A path that no longer resolves is dropped, not remapped: `vobAtIndexPath`
 * returning null means the world has changed under this entry (the VOB was
 * deleted, or moved by an edit elsewhere in its ancestry), and showing
 * whatever VOB now happens to sit at that path would be a silent wrong answer
 * rather than an honest gap.
 */
export function resolveFolderMembers(reader: VobReader, folder: VobFolder): number[] {
  const members: number[] = [];
  for (const path of folder.vobPaths) {
    const vob = vobAtIndexPath(reader, path);
    if (vob !== null) members.push(vob);
  }
  return members;
}

/**
 * Defensive coercion for `VobFolders` read off disk — the one function here
 * that does not trust its input, because a file on disk is a boundary a stray
 * edit or a future format change can violate. Anything malformed collapses to
 * the empty state rather than throwing: a corrupt sidecar should not block
 * opening the world it describes.
 */
export function parseVobFolders(raw: unknown): VobFolders {
  if (typeof raw !== 'object' || raw === null || !('folders' in raw) || !Array.isArray(raw.folders)) {
    return emptyVobFolders();
  }

  const folders: VobFolder[] = [];
  for (const entry of raw.folders) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, name, vobPaths } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || !Array.isArray(vobPaths)) continue;
    folders.push({ id, name, vobPaths: vobPaths.filter((path): path is string => typeof path === 'string') });
  }
  return { folders };
}
