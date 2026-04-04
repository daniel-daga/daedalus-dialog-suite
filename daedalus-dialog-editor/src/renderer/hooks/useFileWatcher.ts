import { useEffect, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useFileStore } from '../store/fileStore';
import type { FileChangeEvent } from '../types/global';

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
  } catch (err) {
    console.error('[FileWatcher] Failed to parse new file:', filePath, err);
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
