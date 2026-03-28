import React, { useState, useCallback, useMemo, useEffect, useDeferredValue } from 'react';
import { useFunctionTreeBuilder } from './hooks/useFunctionTreeBuilder';
import { useRecentDialogTabs } from './hooks/useRecentDialogTabs';
import { useDialogFactory } from './hooks/useDialogFactory';
import { useDialogTransition } from './hooks/useDialogTransition';
import { useNpcDialogErrors } from './hooks/useNpcDialogErrors';
import { useDialogNavigation } from './hooks/useDialogNavigation';
import { useSearchNavigation } from './hooks/useSearchNavigation';
import { Box, Typography, Alert, Button } from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import { useUISelectionStore } from '../store/uiSelectionStore';
import { useProjectStore } from '../store/projectStore';
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
  } = useEditorStore();
  const {
    selectedNPC,
    selectedDialog,
    selectedFunctionName,
    setSelectedNPC,
    setSelectedFunctionName,
  } = useUISelectionStore();
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
  const fileState = filePath ? openFiles.get(filePath) : null;

  const [expandedDialogs, setExpandedDialogs] = useState<Set<string>>(new Set());
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set());
  const [operationError, setOperationError] = useState<string | null>(null);
  const { recentDialogs, addRecentDialog, closeRecentDialog } = useRecentDialogTabs();

  const isProjectMode = !!projectPath;
  const semanticModel: SemanticModel = isProjectMode ? mergedSemanticModel : (fileState?.semanticModel ?? EMPTY_SEMANTIC_MODEL);

  // Defer the semantic model update for the heavy tree view to prevent blocking the main thread
  const deferredSemanticModel = useDeferredValue(semanticModel);

  // Determine early return conditions (but don't return yet — hooks must be called first)
  const showLoading = !isProjectMode && !fileState;
  const showSyntaxErrors = fileState?.hasErrors && !fileState?.autoSaveError;

  // RAF-based state transition sequencing
  const { isLoadingDialog, setIsLoadingDialog, finalizeDialogSelection, editorScrollRef } = useDialogTransition();

  // Derive active NPC name from the selected dialog (used by recent-tab close logic)
  const activeNpcName = selectedDialog
    ? semanticModel.dialogs?.[selectedDialog]?.properties?.npc || selectedNPC || null
    : null;

  // Error display — parse errors for the selected NPC's dialog files
  const { npcDialogErrors, hasNpcDialogErrors } = useNpcDialogErrors({
    isProjectMode,
    selectedNPC,
    dialogIndex,
    parsedFiles,
  });

  // NPC/dialog selection and navigation handlers
  const {
    handleSelectNPC,
    navigateToDialogWithLoading,
    handleSelectDialog,
    handleSelectRecentDialog,
    handleCloseRecentDialog,
  } = useDialogNavigation({
    isProjectMode,
    selectedNPC,
    selectedDialog,
    activeNpcName,
    finalizeDialogSelection,
    setIsLoadingDialog,
    setOperationError,
    closeRecentDialog,
  });

  // Search panel visibility, keyboard shortcuts, and result navigation
  const { isSearchOpen, setIsSearchOpen, handleSearchResultClick } = useSearchNavigation({
    semanticModel,
    handleSelectNPC,
    navigateToDialogWithLoading,
    setOperationError,
  });

  // Build function tree for a given function (recursively finds choice branches).
  // Uses deferred functions to avoid re-calculating on every keystroke.
  const deferredFunctions = deferredSemanticModel.functions;
  const buildFunctionTree = useFunctionTreeBuilder(deferredFunctions);

  // Memoize NPC map extraction to avoid rebuilding on every render
  // In project mode, use project NPCs; in single-file mode, extract from file
  const { npcMap, npcs } = useMemo(() => {
    if (isProjectMode) {
      const map = new Map<string, string[]>();
      dialogIndex.forEach((dialogMetadataArray, npcId) => {
        const dialogNames = dialogMetadataArray.map(metadata => metadata.dialogName);
        map.set(npcId, dialogNames);
      });
      return { npcMap: map, npcs: projectNpcs };
    }

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
    setSelectedFunctionName(functionName);
    if (selectedDialog) {
      setExpandedDialogs((prev) => new Set([...prev, selectedDialog]));
    }
  };

  // Handle early return conditions after all hooks have been called
  // In project mode, we might not have a file loaded yet
  if (showLoading) {
    return <Typography>Loading...</Typography>;
  }

  // Check for syntax errors — if present, show error display instead of editor
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
