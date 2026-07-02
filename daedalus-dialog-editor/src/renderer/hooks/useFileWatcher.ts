import { useEffect, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useFileStore } from '../store/fileStore';
import { planExitDialogsForAddedFile } from '../utils/npcExitDialog';
import type { FileChangeEvent, SemanticModel } from '../types/global';

/**
 * Hook that watches the project directory for external file changes.
 *
 * When a .d file is added, changed, or removed outside the editor, the
 * corresponding semantic model cache is invalidated and re-parsed so the
 * UI stays in sync with the file system.
 */
export function useFileWatcher(): void {
  const projectPath = useProjectStore((s) => s.projectPath);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!projectPath) {
      // No project open — make sure watcher is stopped
      window.editorAPI.stopFileWatcher().catch(() => {});
      return;
    }

    // Start the file watcher for this project
    window.editorAPI.startFileWatcher(projectPath).catch((err) => {
      console.error('[useFileWatcher] Failed to start watcher:', err);
    });

    // Subscribe to change events from the main process
    const unsubscribe = window.editorAPI.onFileChanged((event: FileChangeEvent) => {
      handleFileChange(event);
    });
    unsubscribeRef.current = unsubscribe;

    return () => {
      // Clean up on unmount or project change
      unsubscribe();
      unsubscribeRef.current = null;
      window.editorAPI.stopFileWatcher().catch(() => {});
    };
  }, [projectPath]);
}

async function handleFileChange(event: FileChangeEvent): Promise<void> {
  const { type, filePath } = event;
  const projectStore = useProjectStore.getState();
  const fileStore = useFileStore.getState();

  switch (type) {
    case 'change':
      await handleFileModified(filePath, projectStore, fileStore);
      break;

    case 'add':
      await handleFileAdded(filePath, projectStore);
      break;

    case 'unlink':
      handleFileRemoved(filePath, projectStore, fileStore);
      break;
  }
}

/**
 * A file was modified externally — re-parse it and update caches.
 */
async function handleFileModified(
  filePath: string,
  projectStore: ReturnType<typeof useProjectStore.getState>,
  fileStore: ReturnType<typeof useFileStore.getState>
): Promise<void> {
  // If the file is currently open in the editor, reload it
  const openFileState = fileStore.openFiles.get(filePath);
  if (openFileState) {
    // If the file has unsaved changes in the editor, skip the reload
    // to avoid overwriting the user's work
    if (openFileState.isDirty) {
      console.log('[FileWatcher] Skipping reload of dirty file:', filePath);
      return;
    }

    try {
      await fileStore.openFile(filePath);
    } catch (err) {
      console.error('[FileWatcher] Failed to reload open file:', filePath, err);
    }
    return;
  }

  // Otherwise, invalidate and re-parse in the project cache
  try {
    const semanticModel = await window.editorAPI.parseDialogFile(filePath);

    // Inject file path into constants and variables for tracking
    if (semanticModel.constants) {
      Object.values(semanticModel.constants).forEach((c: any) => { c.filePath = filePath; });
    }
    if (semanticModel.variables) {
      Object.values(semanticModel.variables).forEach((v: any) => { v.filePath = filePath; });
    }

    projectStore.updateFileModel(filePath, semanticModel);
  } catch (err) {
    console.error('[FileWatcher] Failed to re-parse file:', filePath, err);
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

    if (semanticModel.constants) {
      Object.values(semanticModel.constants).forEach((c: any) => { c.filePath = filePath; });
    }
    if (semanticModel.variables) {
      Object.values(semanticModel.variables).forEach((v: any) => { v.filePath = filePath; });
    }

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
  // Close the file in the editor if it was open
  if (fileStore.openFiles.has(filePath)) {
    fileStore.closeFile(filePath);
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
