import React, { useState, useCallback, useMemo, useTransition, useRef, useEffect, useDeferredValue } from 'react';
import { useFunctionTreeBuilder } from './hooks/useFunctionTreeBuilder';
import { useRecentDialogTabs } from './hooks/useRecentDialogTabs';
import { useDialogFactory } from './hooks/useDialogFactory';
import { Box, Typography, Alert, Button } from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { SearchResult } from '../store/searchStore';
import { useNavigation } from '../hooks/useNavigation';
import NPCList from './NPCList';
import DialogTree from './DialogTree';
import EditorPane from './EditorPane';
import SyntaxErrorsDisplay from './SyntaxErrorsDisplay';
import SearchPanel from './SearchPanel';
import type { SemanticModel } from '../types/global';
import { extractFunctionName } from '../utils/pathAndIdentifierUtils';

interface ThreeColumnLayoutProps {
  filePath: string | null;
}

const EMPTY_SEMANTIC_MODEL: SemanticModel = {
  dialogs: {},
  functions: {},
  hasErrors: false,
  errors: []
};

const ThreeColumnLayout: React.FC<ThreeColumnLayoutProps> = ({ filePath }) => {
  const { 
    openFiles, 
    openFile,
    updateModel,
    getFileState,
    activeFile,
    selectedNPC,
    selectedDialog,
    selectedFunctionName,
    setSelectedNPC,
    setSelectedDialog,
    setSelectedFunctionName
  } = useEditorStore();
  const {
    projectPath,
    npcList: projectNpcs,
    dialogIndex,
    selectNpc,
    getSemanticModel,
    mergedSemanticModel,
    loadAndMergeNpcModels,
    addDialogToIndex,
    addProjectFile,
    setIngestedFilesOpen,
    parsedFiles,
    allDialogFiles
  } = useProjectStore();
  const { navigateToDialog } = useNavigation();
  const fileState = filePath ? openFiles.get(filePath) : null;

  const [expandedDialogs, setExpandedDialogs] = useState<Set<string>>(new Set());
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set()); // Track expanded choice nodes
  const [_isPending, startTransition] = useTransition(); // Bug #3 fix: correct destructuring
  const [isLoadingDialog, setIsLoadingDialog] = useState(false); // Immediate loading state
  const [isSearchOpen, setIsSearchOpen] = useState(false); // Search panel visibility
  const { recentDialogs, addRecentDialog, closeRecentDialog } = useRecentDialogTabs();
  const [operationError, setOperationError] = useState<string | null>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null); // Ref to scroll container

  // Refs to track RAF IDs for cleanup (Bug #1 fix)
  const rafId1Ref = useRef<number | null>(null);
  const rafId2Ref = useRef<number | null>(null);
  const dialogTransitionIdRef = useRef(0);

  // Determine which mode we're in: project mode or single-file mode
  const isProjectMode = !!projectPath;
  const semanticModel: SemanticModel = isProjectMode ? mergedSemanticModel : (fileState?.semanticModel ?? EMPTY_SEMANTIC_MODEL);

  // Defer the semantic model update for the heavy tree view to prevent blocking the main thread
  const deferredSemanticModel = useDeferredValue(semanticModel);

  // Determine early return conditions (but don't return yet - hooks must be called first)
  const showLoading = !isProjectMode && !fileState;
  const showSyntaxErrors = fileState?.hasErrors && !fileState?.autoSaveError;

  const npcDialogErrors = useMemo(() => {
    if (!isProjectMode || !selectedNPC) return [];

    const dialogMetadata = dialogIndex.get(selectedNPC) || [];
    const npcFilePaths = Array.from(new Set(dialogMetadata.map(m => m.filePath)));

    const errors: { filePath: string; message: string }[] = [];
    npcFilePaths.forEach((filePath) => {
      const parsed = parsedFiles.get(filePath);
      const fileErrors = parsed?.semanticModel?.errors || [];
      if (parsed?.semanticModel?.hasErrors) {
        fileErrors.forEach((err) => {
          errors.push({ filePath, message: err.message });
        });
      }
    });

    return errors;
  }, [isProjectMode, selectedNPC, dialogIndex, parsedFiles]);

  const hasNpcDialogErrors = npcDialogErrors.length > 0;

  // Log parse errors for the selected NPC to the console (for easy debugging)
  useEffect(() => {
    if (!isProjectMode) return;
    if (!selectedNPC) return;
    if (!hasNpcDialogErrors) return;

    console.error(
      `[Dialog Parse Errors] NPC=${selectedNPC} count=${npcDialogErrors.length}`,
      npcDialogErrors
    );
  }, [isProjectMode, selectedNPC, hasNpcDialogErrors, npcDialogErrors]);

  // Keyboard shortcut handler for Ctrl+F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
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

  // Cleanup RAF callbacks on unmount (Bug #1 fix)
  useEffect(() => {
    return () => {
      if (rafId1Ref.current !== null) {
        cancelAnimationFrame(rafId1Ref.current);
      }
      if (rafId2Ref.current !== null) {
        cancelAnimationFrame(rafId2Ref.current);
      }
    };
  }, []);

  // Build function tree for a given function (recursively finds choice branches).
  // Uses deferred functions to avoid re-calculating on every keystroke.
  const deferredFunctions = deferredSemanticModel.functions;
  const buildFunctionTree = useFunctionTreeBuilder(deferredFunctions);

  // Memoize NPC map extraction to avoid rebuilding on every render
  // In project mode, use project NPCs; in single-file mode, extract from file
  const { npcMap, npcs } = useMemo(() => {
    if (isProjectMode) {
      // In project mode, populate npcMap from dialogIndex
      const map = new Map<string, string[]>();
      dialogIndex.forEach((dialogMetadataArray, npcId) => {
        const dialogNames = dialogMetadataArray.map(metadata => metadata.dialogName);
        map.set(npcId, dialogNames);
      });
      return { npcMap: map, npcs: projectNpcs };
    }

    // Single-file mode: extract NPCs from current file
    const map = new Map<string, string[]>();
    Object.entries(semanticModel.dialogs || {}).forEach(([dialogName, dialog]) => {
      const npcName = dialog.properties?.npc || 'Unknown NPC';
      if (!map.has(npcName)) {
        map.set(npcName, []);
      }
      map.get(npcName)!.push(dialogName);
    });

    const npcList = Array.from(map.keys()).sort();

    return { npcMap: map, npcs: npcList };
  }, [isProjectMode, projectNpcs, dialogIndex, semanticModel.dialogs]);

  // Get dialogs for selected NPC
  const dialogsForNPC = selectedNPC ? (npcMap.get(selectedNPC) || []) : [];

  // Get selected dialog data
  const dialogData = selectedDialog ? semanticModel.dialogs?.[selectedDialog] : null;

  // Get the information function for the selected dialog
  const infoFunction = dialogData?.properties?.information;
  const dialogInfoFunctionName = extractFunctionName(infoFunction);

  // Get the currently selected function (either dialog info or choice function)
  const currentFunctionName = selectedFunctionName || dialogInfoFunctionName;
  const currentFunctionData = currentFunctionName ? semanticModel.functions?.[currentFunctionName] : null;
  const activeNpcName = selectedDialog
    ? semanticModel.dialogs?.[selectedDialog]?.properties?.npc || selectedNPC || null
    : null;

  const handleSelectNPC = async (npc: string) => {
    setOperationError(null);
    setSelectedDialog(null);
    setSelectedFunctionName(null);

    try {
      // In project mode, load semantic models for this NPC's dialogs
      if (isProjectMode) {
        selectNpc(npc);

        // Get dialog metadata for this NPC
        const dialogMetadata = dialogIndex.get(npc) || [];

        // Extract unique file paths
        const uniqueFilePaths = [...new Set(dialogMetadata.map(m => m.filePath))];

        // Load semantic models for all files (populates the parsedFiles cache)
        await Promise.all(
          uniqueFilePaths.map(filePath => getSemanticModel(filePath))
        );

        // Load and merge models for this NPC using the store
        loadAndMergeNpcModels(npc);

        setSelectedNPC(npc);
      } else {
        // Single-file mode: just set the selected NPC
        setSelectedNPC(npc);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setOperationError(`Failed to load NPC "${npc}": ${message}`);
      throw error;
    }
  };

  const finalizeDialogSelection = useCallback((dialogName: string, functionName: string | null) => {
    const transitionId = dialogTransitionIdRef.current + 1;
    dialogTransitionIdRef.current = transitionId;

    // Cancel any pending RAF callbacks from previous dialog selection (Bug #1 fix)
    if (rafId1Ref.current !== null) {
      cancelAnimationFrame(rafId1Ref.current);
      rafId1Ref.current = null;
    }
    if (rafId2Ref.current !== null) {
      cancelAnimationFrame(rafId2Ref.current);
      rafId2Ref.current = null;
    }

    // Show loading immediately to prevent stale content flash during transitions
    setIsLoadingDialog(true);

    // Use startTransition to keep UI responsive when switching to dialogs with many actions
    startTransition(() => {
      setSelectedDialog(dialogName);
      setSelectedFunctionName(functionName);

      // Use requestAnimationFrame to ensure state changes are committed and painted
      rafId1Ref.current = requestAnimationFrame(() => {
        // Scroll to top after content has changed
        if (editorScrollRef.current) {
          editorScrollRef.current.scrollTop = 0;
        }

        // Wait one more frame to ensure rendering is complete
        rafId2Ref.current = requestAnimationFrame(() => {
          if (dialogTransitionIdRef.current === transitionId) {
            setIsLoadingDialog(false);
          }

          // Clear refs after execution
          rafId1Ref.current = null;
          rafId2Ref.current = null;
        });
      });
    });
  }, [setSelectedDialog, setSelectedFunctionName]);

  const { createDialogForNpc } = useDialogFactory({
    projectPath,
    activeFile,
    filePath,
    allDialogFiles,
    isProjectMode,
    openFiles,
    semanticModel,
    dialogIndex,
    selectedNPC,
    openFile,
    getFileState,
    updateModel,
    addDialogToIndex,
    addProjectFile,
    getSemanticModel,
    selectNpc,
    loadAndMergeNpcModels,
    setSelectedNPC,
    onDialogCreated: (dialogName, infoFunctionName) => {
      setExpandedDialogs((prev) => new Set([...prev, dialogName]));
      finalizeDialogSelection(dialogName, infoFunctionName);
    }
  });

  const handleAddNpc = useCallback(async (npcName: string) => {
    setOperationError(null);
    try {
      await createDialogForNpc(npcName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setOperationError(`Failed to create NPC "${npcName}": ${message}`);
      throw error;
    }
  }, [createDialogForNpc]);

  const handleAddDialog = useCallback(async (dialogName: string) => {
    setOperationError(null);
    if (!selectedNPC) {
      throw new Error('Select an NPC first.');
    }
    try {
      await createDialogForNpc(selectedNPC, dialogName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setOperationError(`Failed to add dialog "${dialogName}": ${message}`);
      throw error;
    }
  }, [selectedNPC, createDialogForNpc]);

  const navigateToDialogWithLoading = useCallback(async (dialogName: string, functionName?: string | null) => {
    setIsLoadingDialog(true);

    try {
      const navigated = await navigateToDialog(dialogName, functionName ?? undefined);
      if (!navigated) {
        setIsLoadingDialog(false);
        return false;
      }

      const { selectedDialog: resolvedDialog, selectedFunctionName: resolvedFunction } = useEditorStore.getState();
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
  }, [navigateToDialog, finalizeDialogSelection]);

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
  }, [isProjectMode, selectedNPC, dialogIndex, activeFile, openFile, finalizeDialogSelection]);

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
    navigateToDialogWithLoading
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
  }, [closeRecentDialog, selectedDialog, activeNpcName, handleSelectRecentDialog, setSelectedDialog, setSelectedFunctionName]);

  useEffect(() => {
    if (!selectedDialog) return;

    const dialog = semanticModel.dialogs?.[selectedDialog];
    if (!dialog) return;

    const npcName = dialog.properties?.npc || selectedNPC || 'Unknown NPC';
    const infoFunction = dialog.properties?.information;
    const infoFunctionName = extractFunctionName(infoFunction);
    const functionName = selectedFunctionName || infoFunctionName || null;

    addRecentDialog(selectedDialog, npcName, functionName);
  }, [selectedDialog, selectedFunctionName, selectedNPC, semanticModel.dialogs, addRecentDialog]);

  const handleToggleDialogExpand = useCallback((dialogName: string) => {
    setExpandedDialogs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(dialogName)) {
        newSet.delete(dialogName);
      } else {
        newSet.add(dialogName);
      }
      return newSet;
    });
  }, []);

  const handleToggleChoiceExpand = useCallback((choiceKey: string) => {
    setExpandedChoices((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(choiceKey)) {
        newSet.delete(choiceKey);
      } else {
        newSet.add(choiceKey);
      }
      return newSet;
    });
  }, []);

  const handleNavigateToFunction = (functionName: string) => {
    // Navigate to the choice function
    setSelectedFunctionName(functionName);
    // Optionally expand the dialog tree to show the choice
    if (selectedDialog) {
      setExpandedDialogs((prev) => new Set([...prev, selectedDialog]));
    }
  };

  // Handle search result click - navigate to the appropriate NPC/dialog/function
  const handleSearchResultClick = useCallback(async (result: SearchResult) => {
    // For NPC results, select the NPC
    if (result.type === 'npc') {
      await handleSelectNPC(result.name);
      return;
    }

    // For dialog results, use the navigation hook
    if (result.type === 'dialog' && result.dialogName) {
      setOperationError(null);
      try {
        const navigated = await navigateToDialogWithLoading(result.dialogName);
        if (!navigated) {
          setOperationError(`Could not find dialog "${result.dialogName}" in the current context.`);
        }
      } catch (error) {
        setIsLoadingDialog(false);
        const message = error instanceof Error ? error.message : 'Unknown error';
        setOperationError(`Failed to navigate to dialog: ${message}`);
      }
      return;
    }

    // For function or text results, try to navigate to the function
    if (result.functionName) {
      // Try to find which dialog this function belongs to
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
            setIsLoadingDialog(false);
            const message = error instanceof Error ? error.message : 'Unknown error';
            setOperationError(`Failed to navigate to dialog: ${message}`);
          }
          return;
        }
      }

      // If not found as a direct dialog function, just navigate to the function
      setSelectedFunctionName(result.functionName);
    }
  }, [semanticModel, handleSelectNPC, navigateToDialogWithLoading]);

  // Handle early return conditions after all hooks have been called
  // In project mode, we might not have a file loaded yet
  if (showLoading) {
    return <Typography>Loading...</Typography>;
  }

  // Check for syntax errors - if present, show error display instead of editor
  if (showSyntaxErrors && fileState) {
    return <SyntaxErrorsDisplay errors={fileState.errors || []} filePath={filePath} />;
  }

  return (
    <Box sx={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden', position: 'relative' }}>
      {operationError && (
        <Alert
          severity="error"
          onClose={() => setOperationError(null)}
          sx={{ position: 'absolute', top: 8, left: 8, right: 8, zIndex: 20 }}
        >
          {operationError}
        </Alert>
      )}
      {/* Search Panel (positioned absolutely) */}
      <SearchPanel
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        semanticModel={semanticModel as SemanticModel}
        dialogIndex={dialogIndex}
        onResultClick={handleSearchResultClick}
      />

      {/* Column 1: NPC List */}
      <NPCList
        npcs={npcs}
        npcMap={npcMap}
        selectedNPC={selectedNPC}
        onSelectNPC={handleSelectNPC}
        onAddNpc={handleAddNpc}
      />

      {/* Column 2: Dialog Tree with Nested Choices */}
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: '0 0 350px', overflow: 'hidden' }}>
        {/* Error Alert for Parsing Errors */}
        {isProjectMode && hasNpcDialogErrors && (
          <Alert severity="error" sx={{ borderRadius: 0, flexShrink: 0 }}>
            <Typography variant="body2" gutterBottom>
              Failed to parse dialog file(s) for {selectedNPC}
            </Typography>
            <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
              {npcDialogErrors.length} error(s) found. Open the file list (top bar list icon) for full details.
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setIngestedFilesOpen(true)}
              sx={{ mb: 0.5 }}
            >
              View details
            </Button>
            {npcDialogErrors.slice(0, 3).map((err, index) => (
              <Typography key={index} variant="caption" display="block" sx={{ whiteSpace: 'pre-wrap' }}>
                - {err.message}
              </Typography>
            ))}
            {npcDialogErrors.length > 3 && (
              <Typography variant="caption" display="block" sx={{ fontStyle: 'italic' }}>
                ...and {npcDialogErrors.length - 3} more
              </Typography>
            )}
          </Alert>
        )}
        <DialogTree
          selectedNPC={selectedNPC}
          dialogsForNPC={dialogsForNPC}
          semanticModel={deferredSemanticModel}
          selectedDialog={selectedDialog}
          selectedFunctionName={selectedFunctionName}
          expandedDialogs={expandedDialogs}
          expandedChoices={expandedChoices}
          onSelectDialog={handleSelectDialog}
          onToggleDialogExpand={handleToggleDialogExpand}
          onToggleChoiceExpand={handleToggleChoiceExpand}
          buildFunctionTree={buildFunctionTree}
          onAddDialog={handleAddDialog}
        />
      </Box>

      {/* Column 3: Function Action Editor */}
      <EditorPane
        ref={editorScrollRef}
        selectedDialog={selectedDialog}
        dialogData={dialogData}
        currentFunctionName={currentFunctionName}
        currentFunctionData={currentFunctionData}
        selectedFunctionName={selectedFunctionName}
        filePath={filePath}
        semanticModel={semanticModel as SemanticModel}
        isLoadingDialog={isLoadingDialog}
        recentDialogs={recentDialogs}
        onSelectRecentDialog={handleSelectRecentDialog}
        onCloseRecentDialog={handleCloseRecentDialog}
        onNavigateToFunction={handleNavigateToFunction}
      />
    </Box>
  );
};

export default ThreeColumnLayout;


