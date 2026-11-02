import { useState, useCallback, useEffect } from 'react';
import { useUISelectionStore } from '../../store/uiSelectionStore';
import { useEditorStore } from '../../store/editorStore';
import type { SearchResult } from '../../store/searchStore';
import type { SemanticModel } from '../../types/global';
import { collectDialogOwnedFunctions } from '../dialogUtils';

export interface UseSearchNavigationProps {
  semanticModel: SemanticModel;
  handleSelectNPC: (npc: string) => Promise<void>;
  navigateToDialogWithLoading: (dialogName: string, functionName?: string | null) => Promise<boolean>;
  setOperationError: (error: string | null) => void;
}

export interface UseSearchNavigationResult {
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  handleSearchResultClick: (result: SearchResult) => Promise<void>;
}

/**
 * Manages the search panel open/close state, the Ctrl+F / Escape keyboard
 * shortcuts that toggle it, and the result-click handler that navigates to
 * the selected NPC, dialog, or function.
 *
 * The Ctrl+F handler is scoped to the dialog view (F6). This hook lives on
 * `ThreeColumnLayout`, which stays mounted under `display: none` while another
 * view is active, so an unscoped handler opened the panel where it could not
 * be seen — silently at the time, and waiting for the user when they returned
 * to the dialog view. The active view is read live rather than subscribed to,
 * so switching views does not re-run this effect.
 */
export function useSearchNavigation({
  semanticModel,
  handleSelectNPC,
  navigateToDialogWithLoading,
  setOperationError,
}: UseSearchNavigationProps): UseSearchNavigationResult {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Keyboard shortcut handler for Ctrl+F / Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (useUISelectionStore.getState().activeView !== 'dialog') {
          return;
        }
        e.preventDefault();
        setIsSearchOpen(true);
      }
      if (e.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSearchOpen]);

  // Handle search result click — navigates to the appropriate NPC/dialog/function
  const handleSearchResultClick = useCallback(async (result: SearchResult) => {
    if (result.type === 'npc') {
      await handleSelectNPC(result.name);
      return;
    }

    if (result.type === 'dialog' && result.dialogName) {
      setOperationError(null);
      try {
        const navigated = await navigateToDialogWithLoading(result.dialogName);
        if (!navigated) {
          setOperationError(`Could not find dialog "${result.dialogName}" in the current context.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setOperationError(`Failed to navigate to dialog: ${message}`);
      }
      return;
    }

    // For function or text results, navigate to the dialog that owns the
    // function: its information or condition function, or a choice target —
    // which is where most hero lines live (#483).
    if (result.functionName) {
      const functionName = result.functionName;
      // The open files' models too: a hit in a file other than the active one
      // still has to open with the dialog that owns it.
      const models = [
        semanticModel,
        ...[...useEditorStore.getState().openFiles.values()].map((file) => file.semanticModel),
      ];
      let ownerDialog: string | null = null;
      for (const model of models) {
        for (const [dialogName, dialog] of Object.entries(model.dialogs || {})) {
          if (collectDialogOwnedFunctions(model, dialog).has(functionName)) {
            ownerDialog = dialogName;
            break;
          }
        }
        if (ownerDialog) break;
      }

      if (!ownerDialog) {
        // No dialog owns this function — select it on its own.
        useUISelectionStore.getState().setSelectedFunctionName(functionName);
        return;
      }

      setOperationError(null);
      try {
        const navigated = await navigateToDialogWithLoading(ownerDialog, functionName);
        if (!navigated) {
          setOperationError(`Could not find dialog "${ownerDialog}" in the current context.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setOperationError(`Failed to navigate to dialog: ${message}`);
      }
    }
  }, [semanticModel, handleSelectNPC, navigateToDialogWithLoading, setOperationError]);

  return { isSearchOpen, setIsSearchOpen, handleSearchResultClick };
}
