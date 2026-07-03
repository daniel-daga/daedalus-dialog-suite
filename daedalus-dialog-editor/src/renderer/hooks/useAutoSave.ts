import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore, type FileState } from '../store/editorStore';
import { classifySaveError, type SaveError } from '../utils/saveError';
import { flushAllPendingEdits } from '../utils/pendingEditFlushRegistry';

interface AutoSaveStatus {
  isAutoSaving: boolean;
  lastAutoSaveTime: Date | null;
}

/**
 * Auto-save candidacy (E3): a file may auto-save only when it is model-dirty,
 * its model is a complete parse (`semanticModel.hasErrors` is authoritative),
 * no validation failure is outstanding, and it is not in external conflict.
 * Source-dirty files are deliberately excluded (they are not model-dirty).
 */
function isAutoSaveCandidate(fileState: FileState): boolean {
  return (
    fileState.isDirty &&
    !fileState.semanticModel.hasErrors &&
    !fileState.autoSaveError &&
    !fileState.externalConflict
  );
}

/**
 * Hook that handles auto-saving of dirty files.
 * Watches for changes to files and automatically saves them after
 * a configurable debounce interval.
 */
export function useAutoSave(): AutoSaveStatus {
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastAutoSaveTime, setLastAutoSaveTime] = useState<Date | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openFiles = useEditorStore((state) => state.openFiles);
  const autoSaveEnabled = useEditorStore((state) => state.autoSaveEnabled);
  const autoSaveInterval = useEditorStore((state) => state.autoSaveInterval);

  const performAutoSave = useCallback(async () => {
    // Drain any debounced condition/action edit (N4) before reading the model,
    // otherwise a tick landing within 300 ms of a keystroke serializes stale text.
    flushAllPendingEdits();

    const state = useEditorStore.getState();
    const filesToSave: string[] = [];

    // Find all auto-save candidates
    state.openFiles.forEach((fileState, filePath) => {
      if (isAutoSaveCandidate(fileState)) {
        filesToSave.push(filePath);
      }
    });

    if (filesToSave.length === 0) {
      return;
    }

    setIsAutoSaving(true);

    try {
      // Save all dirty files; remember which model reference was written so
      // edits that land while a save is in flight are not marked clean
      const successfulSaves = new Map<string, unknown>();
      const failedSaves = new Map<string, any>();
      const rejectedSaves = new Map<string, SaveError>();
      const errors: unknown[] = [];

      await Promise.all(
        filesToSave.map(async (filePath) => {
          const fileState = state.openFiles.get(filePath);
          if (fileState) {
            const savedModel = fileState.semanticModel;
            try {
              // The main process arms file-watcher self-write suppression
              // after the actual write succeeds.
              const result = await window.editorAPI.saveFile(
                filePath,
                savedModel,
                state.codeSettings
              );

              if (result.success) {
                successfulSaves.set(filePath, savedModel);
              } else if (result.validationResult) {
                failedSaves.set(filePath, result.validationResult);
              }
            } catch (err) {
              // Classifiable worker failures (timeout / crash) surface on the
              // file instead of being swallowed; the file stays dirty.
              const saveError = classifySaveError(err);
              if (saveError) {
                rejectedSaves.set(filePath, saveError);
              }
              errors.push(err);
            }
          }
        })
      );

      // Only files whose model reference is unchanged may be marked clean —
      // edits that landed while the save was in flight are not on disk yet.
      // (Compared outside setState: the immer middleware hands the updater
      // draft proxies, which would never be reference-equal.)
      const latestFiles = useEditorStore.getState().openFiles;
      const cleanableFiles = new Set<string>();
      successfulSaves.forEach((savedModel, filePath) => {
        if (latestFiles.get(filePath)?.semanticModel === savedModel) {
          cleanableFiles.add(filePath);
        }
      });

      // Update store with results
      useEditorStore.setState((currentState) => {
        const newOpenFiles = new Map(currentState.openFiles);
        const now = new Date();

        // Mark successful saves as clean
        cleanableFiles.forEach((filePath) => {
          const currentFileState = newOpenFiles.get(filePath);
          if (currentFileState) {
            newOpenFiles.set(filePath, {
              ...currentFileState,
              isDirty: false,
              lastSaved: now,
              hasErrors: false,
              errors: [],
              lastValidationResult: undefined,
              saveError: undefined,
            });
          }
        });

        // Mark rejected saves (worker timeout / crash) — keep the file dirty so
        // work is not lost; the error surfaces via the app-bar indicator.
        rejectedSaves.forEach((saveError, filePath) => {
          const currentFileState = newOpenFiles.get(filePath);
          if (currentFileState) {
            newOpenFiles.set(filePath, {
              ...currentFileState,
              isDirty: true,
              saveError,
            });
          }
        });

        // Mark failed saves with their validation errors. N6: a validation
        // failure is NOT a parse error — it must not touch the parse-state
        // mirror (hasErrors/errors). It sets only autoSaveError, which the gate
        // honours and the next mutation clears.
        failedSaves.forEach((validationResult, filePath) => {
          const currentFileState = newOpenFiles.get(filePath);
          if (currentFileState) {
            newOpenFiles.set(filePath, {
              ...currentFileState,
              isDirty: true, // Keep it dirty so work is not lost
              autoSaveError: validationResult,
            });
          }
        });

        return { openFiles: newOpenFiles };
      });

      if (successfulSaves.size > 0) {
        setLastAutoSaveTime(new Date());
      }

      if (errors.length > 0) {
        throw errors[0];
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
    } finally {
      setIsAutoSaving(false);
    }
  }, []);

  // Watch for dirty file changes and schedule auto-save
  useEffect(() => {
    if (!autoSaveEnabled) {
      // Clear any pending auto-save when disabled
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    // Check if any files are auto-save candidates
    let hasDirtyFiles = false;
    openFiles.forEach((fileState) => {
      if (isAutoSaveCandidate(fileState)) {
        hasDirtyFiles = true;
      }
    });

    if (!hasDirtyFiles) {
      return;
    }

    // Clear previous timeout and set new one (debounce)
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      performAutoSave();
      timeoutRef.current = null;
    }, autoSaveInterval);

    // Cleanup on unmount or dependency change
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [openFiles, autoSaveEnabled, autoSaveInterval, performAutoSave]);

  return {
    isAutoSaving,
    lastAutoSaveTime,
  };
}
