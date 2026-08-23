import { useCallback, useEffect, useState } from 'react';
import { useFileStore, isSourceDirty } from '../store/fileStore';
import { flushAllPendingEdits } from '../utils/pendingEditFlushRegistry';
import { classifySaveError, describeSaveError } from '../utils/saveError';

interface ManualSave {
  saveActiveFile: () => Promise<void>;
  isManualSaving: boolean;
}

/**
 * User-invoked save of the active file (Ctrl+S / Cmd+S and the app-bar Save
 * button). Registers a window-level keydown handler, so it works in every view.
 *
 * Routes through the existing explicit-save pipeline: flush pending debounced
 * edits first (N4), then `saveSource` for a source-dirty file or `saveFile`
 * for a model-dirty one — the same split the window-close guard uses. A clean
 * file, no active file, or an unresolved external conflict (owned by the
 * conflict dialog, E4) is a silent no-op. Failures are reported through
 * `onError` so App surfaces them in its error snackbar.
 */
export function useManualSave(onError: (message: string) => void): ManualSave {
  const [isManualSaving, setIsManualSaving] = useState(false);

  const saveActiveFile = useCallback(async () => {
    // Drain any debounced condition/action edit (N4) so a pending keystroke
    // counts toward dirtiness and is in the model before it is serialized.
    flushAllPendingEdits();

    const store = useFileStore.getState();
    const filePath = store.activeFile;
    const fileState = filePath ? store.openFiles.get(filePath) : undefined;
    if (!filePath || !fileState || fileState.externalConflict) {
      return;
    }

    const sourceDirty = isSourceDirty(fileState);
    if (!sourceDirty && !fileState.isDirty) {
      return;
    }

    setIsManualSaving(true);
    try {
      if (sourceDirty) {
        // Source-dirty: persist the typed source. saveSource throws on failure.
        await store.saveSource(filePath, fileState.workingCode as string);
      } else {
        const result = await store.saveFile(filePath);
        if (!result.success) {
          const messages = (result.validationResult?.errors ?? []).map((err) => err.message);
          onError(
            messages.length > 0
              ? `Save failed: ${messages.join('; ')}`
              : 'Save failed: validation errors prevented saving this file. Your changes are kept in the editor.'
          );
        }
      }
    } catch (error) {
      const saveError = classifySaveError(error);
      onError(
        saveError
          ? describeSaveError(saveError)
          : `Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsManualSaving(false);
    }
  }, [onError]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isSave = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S');
      if (!isSave) {
        return;
      }
      // Always claim Ctrl+S so the browser's save dialog never appears; with
      // nothing dirty or no active file, saveActiveFile is a silent no-op.
      e.preventDefault();
      void saveActiveFile();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveActiveFile]);

  return { saveActiveFile, isManualSaving };
}
