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
      await Promise.all(
        filesToSave.map(async (filePath) => {
          const fileState = state.openFiles.get(filePath);
          if (fileState) {
            await window.editorAPI.saveFile(
              filePath,
              fileState.semanticModel,
              state.codeSettings
            );

            // Update file state to mark as not dirty
            useEditorStore.setState((currentState) => {
              const newOpenFiles = new Map(currentState.openFiles);
              const currentFileState = newOpenFiles.get(filePath);
              if (currentFileState) {
                newOpenFiles.set(filePath, {
                  ...currentFileState,
                  isDirty: false,
                  lastSaved: new Date(),
                });
              }
              return { openFiles: newOpenFiles };
            });
          }
        })
      );

      setLastAutoSaveTime(new Date());
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
