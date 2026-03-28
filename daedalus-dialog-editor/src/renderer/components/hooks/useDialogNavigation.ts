import { useCallback } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { useUISelectionStore } from '../../store/uiSelectionStore';
import { useNavigation } from '../../hooks/useNavigation';
import type { RecentDialogTab } from './useRecentDialogTabs';

export interface UseDialogNavigationProps {
  isProjectMode: boolean;
  selectedNPC: string | null;
  selectedDialog: string | null;
  activeNpcName: string | null;
  finalizeDialogSelection: (dialogName: string, functionName: string | null) => void;
  setIsLoadingDialog: (loading: boolean) => void;
  setOperationError: (error: string | null) => void;
  closeRecentDialog: (
    dialogName: string,
    npcName: string,
    activeDialogName: string | null,
    activeNpcName: string | null
  ) => RecentDialogTab | null;
}

export interface UseDialogNavigationResult {
  handleSelectNPC: (npc: string) => Promise<void>;
  navigateToDialogWithLoading: (dialogName: string, functionName?: string | null) => Promise<boolean>;
  handleSelectDialog: (dialogName: string, functionName: string | null) => Promise<void>;
  handleSelectRecentDialog: (dialogName: string, functionName: string | null, npcName: string) => Promise<void>;
  handleCloseRecentDialog: (dialogName: string, npcName: string) => void;
}

/**
 * Consolidates all NPC and dialog selection/navigation handlers.
 *
 * Each handler follows the same pattern:
 *  - Clear any previous operation error.
 *  - Set the loading flag so the editor shows a spinner.
 *  - Perform async work (loading semantic models, opening files).
 *  - Delegate to `finalizeDialogSelection` for the RAF-based two-frame
 *    commit sequence managed by `useDialogTransition`.
 *  - On failure, clear the loading flag and surface an operation error.
 */
export function useDialogNavigation({
  isProjectMode,
  selectedNPC,
  selectedDialog,
  activeNpcName,
  finalizeDialogSelection,
  setIsLoadingDialog,
  setOperationError,
  closeRecentDialog,
}: UseDialogNavigationProps): UseDialogNavigationResult {
  const { dialogIndex, selectNpc, getSemanticModel, loadAndMergeNpcModels } = useProjectStore();
  const { activeFile, openFile } = useEditorStore();
  const { setSelectedNPC, setSelectedDialog, setSelectedFunctionName } = useUISelectionStore();
  const { navigateToDialog } = useNavigation();

  const handleSelectNPC = useCallback(async (npc: string) => {
    setOperationError(null);
    setSelectedDialog(null);
    setSelectedFunctionName(null);

    try {
      if (isProjectMode) {
        selectNpc(npc);

        const dialogMetadata = dialogIndex.get(npc) || [];
        const uniqueFilePaths = [...new Set(dialogMetadata.map(m => m.filePath))];

        await Promise.all(
          uniqueFilePaths.map(filePath => getSemanticModel(filePath))
        );

        loadAndMergeNpcModels(npc);
        setSelectedNPC(npc);
      } else {
        setSelectedNPC(npc);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setOperationError(`Failed to load NPC "${npc}": ${message}`);
      throw error;
    }
  }, [
    isProjectMode,
    dialogIndex,
    selectNpc,
    getSemanticModel,
    loadAndMergeNpcModels,
    setSelectedNPC,
    setSelectedDialog,
    setSelectedFunctionName,
    setOperationError,
  ]);

  const navigateToDialogWithLoading = useCallback(async (dialogName: string, functionName?: string | null) => {
    setIsLoadingDialog(true);

    try {
      const navigated = await navigateToDialog(dialogName, functionName ?? undefined);
      if (!navigated) {
        setIsLoadingDialog(false);
        return false;
      }

      const { selectedDialog: resolvedDialog, selectedFunctionName: resolvedFunction } = useUISelectionStore.getState();
      if (!resolvedDialog) {
        setIsLoadingDialog(false);
        return false;
      }

      finalizeDialogSelection(resolvedDialog, resolvedFunction ?? null);
      return true;
    } catch (error) {
      setIsLoadingDialog(false);
      throw error;
    }
  }, [navigateToDialog, finalizeDialogSelection, setIsLoadingDialog]);

  const handleSelectDialog = useCallback(async (dialogName: string, functionName: string | null) => {
    setOperationError(null);
    setIsLoadingDialog(true);

    try {
      // In project mode, ensure the file containing this dialog is opened in editorStore
      // so that it can be edited (DialogDetailsEditor requires a filePath in openFiles)
      if (isProjectMode && selectedNPC) {
        const npcDialogs = dialogIndex.get(selectedNPC);
        const metadata = npcDialogs?.find(d => d.dialogName === dialogName);
        if (metadata && metadata.filePath && activeFile !== metadata.filePath) {
          await openFile(metadata.filePath);
        }
      }

      finalizeDialogSelection(dialogName, functionName);
    } catch (error) {
      setIsLoadingDialog(false);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setOperationError(`Failed to switch dialog: ${message}`);
    }
  }, [
    isProjectMode,
    selectedNPC,
    dialogIndex,
    activeFile,
    openFile,
    finalizeDialogSelection,
    setIsLoadingDialog,
    setOperationError,
  ]);

  const handleSelectRecentDialog = useCallback(async (dialogName: string, functionName: string | null, npcName: string) => {
    setOperationError(null);
    setIsLoadingDialog(true);

    try {
      if (isProjectMode) {
        const dialogMetadata = dialogIndex.get(npcName) || [];
        const metadata = dialogMetadata.find((entry) => entry.dialogName === dialogName);

        if (metadata) {
          selectNpc(npcName);
          setSelectedNPC(npcName);

          const uniqueFilePaths = [...new Set(dialogMetadata.map((entry) => entry.filePath))];
          await Promise.all(uniqueFilePaths.map((path) => getSemanticModel(path)));
          loadAndMergeNpcModels(npcName);

          if (activeFile !== metadata.filePath) {
            await openFile(metadata.filePath);
          }

          finalizeDialogSelection(dialogName, functionName);
          return;
        }
      }

      const navigated = await navigateToDialogWithLoading(dialogName, functionName);
      if (!navigated) {
        setOperationError(`Could not find dialog "${dialogName}" in the current context.`);
      }
    } catch (error) {
      console.error('Failed to switch recent dialog tab:', error);
      setIsLoadingDialog(false);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setOperationError(`Failed to switch dialog tab: ${message}`);
    }
  }, [
    isProjectMode,
    dialogIndex,
    selectNpc,
    setSelectedNPC,
    getSemanticModel,
    loadAndMergeNpcModels,
    activeFile,
    openFile,
    finalizeDialogSelection,
    navigateToDialogWithLoading,
    setIsLoadingDialog,
    setOperationError,
  ]);

  const handleCloseRecentDialog = useCallback((dialogName: string, npcName: string) => {
    const nextTabToSelect = closeRecentDialog(dialogName, npcName, selectedDialog, activeNpcName);

    if (nextTabToSelect) {
      void handleSelectRecentDialog(nextTabToSelect.dialogName, nextTabToSelect.functionName, nextTabToSelect.npcName);
      return;
    }

    if (selectedDialog === dialogName && activeNpcName === npcName) {
      setSelectedDialog(null);
      setSelectedFunctionName(null);
      setIsLoadingDialog(false);
    }
  }, [
    closeRecentDialog,
    selectedDialog,
    activeNpcName,
    handleSelectRecentDialog,
    setSelectedDialog,
    setSelectedFunctionName,
    setIsLoadingDialog,
  ]);

  return {
    handleSelectNPC,
    navigateToDialogWithLoading,
    handleSelectDialog,
    handleSelectRecentDialog,
    handleCloseRecentDialog,
  };
}
