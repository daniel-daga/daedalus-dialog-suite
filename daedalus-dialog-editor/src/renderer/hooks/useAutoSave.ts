import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore, type FileState } from '../store/editorStore';
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
      // The write itself is `fileStore.saveFile` (3.1): it is the only place
      // that knows the mid-flight-edit rule, the parse-state invariant and how
      // an EXTERNAL_MODIFICATION rejection becomes `externalConflict` rather
      // than a generic save-error chip. This hook keeps only candidacy,
      // scheduling and the auto-save-specific `autoSaveError`.
      const failedSaves = new Map<string, any>();
      const errors: unknown[] = [];
      let anySucceeded = false;

      await Promise.all(
        filesToSave.map(async (filePath) => {
          try {
            const result = await useEditorStore.getState().saveFile(filePath);
            if (result.success) {
              anySucceeded = true;
            } else if (result.validationResult) {
              failedSaves.set(filePath, result.validationResult);
            }
          } catch (err) {
            // `saveFile` has already recorded the classifiable failure on the
            // file (saveError, or externalConflict for a mid-save external
            // change) and left it dirty.
            errors.push(err);
          }
        })
      );

      // Mark failed saves with their validation errors. N6: a validation
      // failure is NOT a parse error — it must not touch the parse-state
      // mirror (hasErrors/errors). It sets only autoSaveError, which the gate
      // honours and the next mutation clears.
      if (failedSaves.size > 0) {
        useEditorStore.setState((currentState) => {
          const newOpenFiles = new Map(currentState.openFiles);
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
      }

      if (anySucceeded) {
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

  // Watch for dirty file changes and schedule auto-save.
  //
  // §3 P1: this is a transient store subscription, NOT a render subscription —
  // a `useEditorStore((s) => s.openFiles)` hook here would re-render the host
  // component (App) on every edit flush to any open file. The debounce
  // semantics are unchanged: every `openFiles` change clears the pending timer
  // and re-arms it while any auto-save candidate exists.
  useEffect(() => {
    const clearPending = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    if (!autoSaveEnabled) {
      // Clear any pending auto-save when disabled
      clearPending();
      return;
    }

    const reschedule = (openFiles: Map<string, FileState>) => {
      // Clear previous timeout; re-arm only while a candidate exists (debounce)
      clearPending();

      let hasDirtyFiles = false;
      openFiles.forEach((fileState) => {
        if (isAutoSaveCandidate(fileState)) {
          hasDirtyFiles = true;
        }
      });

      if (!hasDirtyFiles) {
        return;
      }

      timeoutRef.current = setTimeout(() => {
        performAutoSave();
        timeoutRef.current = null;
      }, autoSaveInterval);
    };

    // Cover files that are already dirty when the hook mounts / re-arms
    reschedule(useEditorStore.getState().openFiles);

    const unsubscribe = useEditorStore.subscribe((state, prevState) => {
      if (state.openFiles !== prevState.openFiles) {
        reschedule(state.openFiles);
      }
    });

    // Cleanup on unmount or dependency change
    return () => {
      unsubscribe();
      clearPending();
    };
  }, [autoSaveEnabled, autoSaveInterval, performAutoSave]);

  return {
    isAutoSaving,
    lastAutoSaveTime,
  };
}
