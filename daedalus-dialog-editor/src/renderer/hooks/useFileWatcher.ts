import { useEffect, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useFileStore, hasUnsavedChanges } from '../store/fileStore';
import { planExitDialogsForAddedFile } from '../utils/npcExitDialog';
import type { FileChangeEvent, SemanticModel } from '../types/global';

// Batch window for external 'change' events. A bulk operation (git checkout,
// branch switch) fires one event per touched file; handling each immediately
// used to cost an O(project) store cascade per event. Changes are buffered for
// this window, deduped by path, re-parsed with bounded concurrency, and
// applied through a single projectStore.updateFileModels call — one
// parsedFiles clone, one parseGeneration bump, at most one re-merge.
const CHANGE_BATCH_WINDOW_MS = 250;
const CHANGE_PARSE_CONCURRENCY = 8;

const pendingChangedPaths = new Set<string>();
let changeFlushTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingChanges(): void {
  pendingChangedPaths.clear();
  if (changeFlushTimer !== null) {
    clearTimeout(changeFlushTimer);
    changeFlushTimer = null;
  }
}

function queueChangedFile(filePath: string): void {
  pendingChangedPaths.add(filePath);
  if (changeFlushTimer === null) {
    changeFlushTimer = setTimeout(() => {
      changeFlushTimer = null;
      void flushChangedFiles();
    }, CHANGE_BATCH_WINDOW_MS);
  }
}

/**
 * Hook that watches the project directory for external file changes.
 *
 * When a .d file is added, changed, or removed outside the editor, the
 * corresponding semantic model cache is invalidated and re-parsed so the
 * UI stays in sync with the file system.
 */
export function useFileWatcher(): void {
  const projectPath = useProjectStore((s) => s.projectPath);
  const scriptsRoot = useProjectStore((s) => s.scriptsRoot);
  const watchRoot = scriptsRoot ?? projectPath;
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!watchRoot) {
      // No project open — make sure watcher is stopped
      window.editorAPI.stopFileWatcher().catch(() => {});
      return;
    }

    // Start the file watcher for this project
    window.editorAPI.startFileWatcher(watchRoot).catch((err) => {
      console.error('[useFileWatcher] Failed to start watcher:', err);
    });

    // Subscribe to change events from the main process
    const unsubscribe = window.editorAPI.onFileChanged((event: FileChangeEvent) => {
      handleFileChange(event);
    });
    unsubscribeRef.current = unsubscribe;

    return () => {
      // Clean up on unmount or project change; buffered changes belong to the
      // watcher subscription that just ended, so drop them.
      unsubscribe();
      unsubscribeRef.current = null;
      clearPendingChanges();
      window.editorAPI.stopFileWatcher().catch(() => {});
    };
  }, [watchRoot]);
}

async function handleFileChange(event: FileChangeEvent): Promise<void> {
  const { type, filePath } = event;
  const projectStore = useProjectStore.getState();
  const fileStore = useFileStore.getState();

  switch (type) {
    case 'change':
      queueChangedFile(filePath);
      break;

    case 'add':
      // A queued change is subsumed by the add's own parse.
      pendingChangedPaths.delete(filePath);
      await handleFileAdded(filePath, projectStore);
      break;

    case 'unlink':
      // A queued change must not resurrect the removed file.
      pendingChangedPaths.delete(filePath);
      handleFileRemoved(filePath, projectStore, fileStore);
      break;
  }
}

/** Inject the source file path into symbols for cross-file tracking. */
function injectFilePathIntoSymbols(semanticModel: SemanticModel, filePath: string): void {
  if (semanticModel.constants) {
    Object.values(semanticModel.constants).forEach((c: any) => { c.filePath = filePath; });
  }
  if (semanticModel.variables) {
    Object.values(semanticModel.variables).forEach((v: any) => { v.filePath = filePath; });
  }
}

/**
 * Flush the buffered 'change' events: open files are reloaded or marked
 * conflicted individually (their state is read at flush time, not event
 * time); background files are re-parsed with bounded concurrency and applied
 * in one batched store update.
 */
async function flushChangedFiles(): Promise<void> {
  const paths = Array.from(pendingChangedPaths);
  pendingChangedPaths.clear();
  if (paths.length === 0) return;

  const fileStore = useFileStore.getState();
  if (!useProjectStore.getState().projectPath) {
    // Project closed while the batch was buffered — nothing to update.
    return;
  }

  const backgroundPaths: string[] = [];
  for (const filePath of paths) {
    const openFileState = fileStore.openFiles.get(filePath);
    if (!openFileState) {
      backgroundPaths.push(filePath);
      continue;
    }

    // If the file has unsaved changes in the editor (model- or source-dirty, or
    // already in conflict), record an external conflict instead of overwriting
    // the user's work — the conflict dialog then drives resolution (E4).
    if (hasUnsavedChanges(openFileState)) {
      fileStore.markExternalConflict(filePath);
      continue;
    }

    // Clean file: reload in place (preserves activeFile, reuses the slot — N3).
    try {
      await fileStore.reloadFile(filePath);
    } catch (err) {
      console.error('[FileWatcher] Failed to reload open file:', filePath, err);
    }
  }

  // Re-parse background files with bounded concurrency and apply as one batch.
  const updates: Array<{ filePath: string; model: SemanticModel }> = [];
  let nextIndex = 0;
  const parseNext = async (): Promise<void> => {
    while (nextIndex < backgroundPaths.length) {
      const filePath = backgroundPaths[nextIndex++];
      try {
        const semanticModel = await window.editorAPI.parseDialogFile(filePath);
        injectFilePathIntoSymbols(semanticModel, filePath);
        updates.push({ filePath, model: semanticModel });
      } catch (err) {
        console.error('[FileWatcher] Failed to re-parse file:', filePath, err);
      }
    }
  };
  await Promise.all(
    Array(Math.min(CHANGE_PARSE_CONCURRENCY, backgroundPaths.length))
      .fill(null)
      .map(() => parseNext())
  );

  if (updates.length > 0) {
    useProjectStore.getState().updateFileModels(updates);
  }
}

/**
 * A new .d file was added to the project — parse and index it.
 */
async function handleFileAdded(
  filePath: string,
  projectStore: ReturnType<typeof useProjectStore.getState>
): Promise<void> {
  // Register the file path in the project
  projectStore.addProjectFile(filePath);

  // Parse and cache it
  try {
    const semanticModel = await window.editorAPI.parseDialogFile(filePath);
    injectFilePathIntoSymbols(semanticModel, filePath);

    projectStore.updateFileModel(filePath, semanticModel);

    // If the file contains dialog metadata, add it to the dialog index
    if (semanticModel.dialogs) {
      for (const [dialogName, dialog] of Object.entries(semanticModel.dialogs)) {
        const npc = dialog?.properties?.npc;
        if (npc) {
          projectStore.addDialogToIndex({
            dialogName,
            npc: typeof npc === 'string' ? npc : String(npc),
            filePath,
          });
        }
      }
    }

    // If the file introduces NPCs that have no dialogs yet, auto-create their
    // EXIT dialog file (issue #141)
    await autoCreateExitDialogFiles(filePath, semanticModel);
  } catch (err) {
    console.error('[FileWatcher] Failed to parse new file:', filePath, err);
  }
}

/**
 * Issue #141: a new NPC .d file dropped into the project should automatically
 * get a DIA_<NPC>.d file with the standard EXIT dialog. The editor's own
 * writes are suppressed by the file watcher, so each generated file is fed
 * back through handleFileAdded to parse and index it immediately.
 */
async function autoCreateExitDialogFiles(
  addedFilePath: string,
  model: SemanticModel
): Promise<void> {
  const projectStore = useProjectStore.getState();
  const plans = planExitDialogsForAddedFile({
    model,
    addedFilePath,
    npcPrototypes: projectStore.npcPrototypes,
    dialogIndex: projectStore.dialogIndex,
  });

  for (const plan of plans) {
    // Never overwrite an EXIT dialog file that already exists on disk
    const existing = await window.editorAPI.readFile(plan.filePath).catch(() => null);
    if (typeof existing === 'string' && existing.length > 0) continue;

    try {
      const result = await window.editorAPI.writeFile(plan.filePath, plan.content);
      if (!result?.success) {
        console.error('[FileWatcher] Failed to create EXIT dialog file:', plan.filePath);
        continue;
      }
    } catch (err) {
      console.error('[FileWatcher] Failed to create EXIT dialog file:', plan.filePath, err);
      continue;
    }

    await handleFileAdded(plan.filePath, useProjectStore.getState());
  }
}

/**
 * A .d file was removed from the project — clean up caches.
 */
function handleFileRemoved(
  filePath: string,
  projectStore: ReturnType<typeof useProjectStore.getState>,
  fileStore: ReturnType<typeof useFileStore.getState>
): void {
  // Close the file in the editor if it was open. But if it holds unsaved work
  // (N5: external delete/rename of a dirty file), keep the FileState — the only
  // copy of the user's edits — and mark a fileMissing conflict so the dialog
  // can offer to restore it.
  const openFileState = fileStore.openFiles.get(filePath);
  if (openFileState) {
    if (hasUnsavedChanges(openFileState)) {
      fileStore.markExternalConflict(filePath, { fileMissing: true });
    } else {
      fileStore.closeFile(filePath);
    }
  }

  // Remove from project cache — clearing the cache entry is sufficient
  // since the project index will be rebuilt on next full reload
  projectStore.updateFileModel(filePath, {
    dialogs: {},
    functions: {},
    constants: {},
    variables: {},
    instances: {},
    items: {},
    npcs: {},
    animations: {},
    hasErrors: false,
    errors: [],
  });
}
