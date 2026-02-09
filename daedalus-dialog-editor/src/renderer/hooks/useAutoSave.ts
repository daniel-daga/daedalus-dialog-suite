import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';

interface AutoSaveStatus {
  isAutoSaving: boolean;
  lastAutoSaveTime: Date | null;
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
  const codeSettings = useEditorStore((state) => state.codeSettings);

  const performAutoSave = useCallback(async () => {
    const state = useEditorStore.getState();
    const filesToSave: string[] = [];

    // Find all dirty files without errors
    state.openFiles.forEach((fileState, filePath) => {
      if (fileState.isDirty && !fileState.hasErrors) {
        filesToSave.push(filePath);
      }
    });

    if (filesToSave.length === 0) {
      return;
    }

    setIsAutoSaving(true);

    try {
      // Save all dirty files
      const successfulSaves: string[] = [];
      const failedSaves = new Map<string, any>();
      const errors: unknown[] = [];

      await Promise.all(
        filesToSave.map(async (filePath) => {
          const fileState = state.openFiles.get(filePath);
          if (fileState) {
            try {
              const result = await window.editorAPI.saveFile(
                filePath,
                fileState.semanticModel,
                state.codeSettings
              );
              
              if (result.success) {
                successfulSaves.push(filePath);
              } else if (result.validationResult) {
                failedSaves.set(filePath, result.validationResult);
              }
            } catch (err) {
              errors.push(err);
            }
          }
        })
      );

      // Update store with results
      useEditorStore.setState((currentState) => {
        const newOpenFiles = new Map(currentState.openFiles);
        const now = new Date();

        // Mark successful saves as clean
        successfulSaves.forEach((filePath) => {
          const currentFileState = newOpenFiles.get(filePath);
          if (currentFileState) {
            newOpenFiles.set(filePath, {
              ...currentFileState,
              isDirty: false,
              lastSaved: now,
              hasErrors: false,
              errors: [],
              lastValidationResult: undefined,
            });
          }
        });

        // Mark failed saves with their validation errors
        failedSaves.forEach((validationResult, filePath) => {
          const currentFileState = newOpenFiles.get(filePath);
          if (currentFileState) {
            newOpenFiles.set(filePath, {
              ...currentFileState,
              isDirty: true, // Keep it dirty so work is not lost
              hasErrors: !validationResult.isValid,
              autoSaveError: validationResult,
              errors: validationResult.errors.filter((e: any) => e.type === 'syntax_error').map((e: any) => ({
                message: e.message,
                line: e.position?.row,
                column: e.position?.column
              })),
            });
          }
        });

        return { openFiles: newOpenFiles };
      });

      if (successfulSaves.length > 0) {
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

    // Check if any files are dirty
    let hasDirtyFiles = false;
    openFiles.forEach((fileState) => {
      if (fileState.isDirty && !fileState.hasErrors) {
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
