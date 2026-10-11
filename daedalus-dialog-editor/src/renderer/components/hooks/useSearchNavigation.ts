import { useState, useCallback, useEffect } from 'react';
import { useUISelectionStore } from '../../store/uiSelectionStore';
import type { SearchResult } from '../../store/searchStore';
import type { SemanticModel } from '../../types/global';
import { extractFunctionName } from '../../utils/pathAndIdentifierUtils';

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

    // For function or text results, try to navigate via the owning dialog
    if (result.functionName) {
      const dialogs = semanticModel.dialogs || {};
      for (const [dialogName, dialog] of Object.entries(dialogs)) {
        const infoFuncName = extractFunctionName(dialog.properties?.information);

        if (infoFuncName === result.functionName) {
          setOperationError(null);
          try {
            const navigated = await navigateToDialogWithLoading(dialogName);
            if (!navigated) {
              setOperationError(`Could not find dialog "${dialogName}" in the current context.`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            setOperationError(`Failed to navigate to dialog: ${message}`);
          }
          return;
        }
      }

      // Not a dialog info function — navigate directly to the function
      useUISelectionStore.getState().setSelectedFunctionName(result.functionName);
    }
  }, [semanticModel, handleSelectNPC, navigateToDialogWithLoading, setOperationError]);

  return { isSearchOpen, setIsSearchOpen, handleSearchResultClick };
}
