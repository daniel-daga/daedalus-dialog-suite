import React, { useState, useCallback, useMemo, useEffect, useDeferredValue } from 'react';
import { useFunctionTreeBuilder } from './hooks/useFunctionTreeBuilder';
import { useRecentDialogTabs } from './hooks/useRecentDialogTabs';
import { useDialogFactory } from './hooks/useDialogFactory';
import { useDialogTransition } from './hooks/useDialogTransition';
import { useDialogNavigation } from './hooks/useDialogNavigation';
import { useSearchNavigation } from './hooks/useSearchNavigation';
import { Box, Typography, Alert } from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import { useUISelectionStore } from '../store/uiSelectionStore';
import { useProjectStore } from '../store/projectStore';
import NpcColumn from './NpcColumn';
import DialogTreeColumn from './DialogTreeColumn';
import EditorColumn from './EditorColumn';
import SyntaxErrorsDisplay from './SyntaxErrorsDisplay';
import SearchPanel from './SearchPanel';
import DeleteDialogConfirmDialog from './DeleteDialogConfirmDialog';
import RenameDialogConfirmDialog from './RenameDialogConfirmDialog';
import type { FunctionRenameEntry } from './RenameDialogConfirmDialog';
import type { SemanticModel } from '../types/global';
import { extractFunctionName } from '../utils/pathAndIdentifierUtils';
import * as historyActions from '../store/historyActions';

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
  const [operationError, setOperationError] = useState<string | null>(null);
  const { recentDialogs, addRecentDialog, closeRecentDialog, renameRecentDialog } = useRecentDialogTabs();

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

  // Get dialogs for selected NPC (computed without npcMap to avoid redundant work)
  const dialogsForNPC = useMemo(() => {
    if (!selectedNPC) return [];
    if (isProjectMode) {
      return (dialogIndex.get(selectedNPC) || []).map(m => m.dialogName);
    }
    return Object.entries(semanticModel.dialogs || {})
      .filter(([, dialog]) => (dialog.properties?.npc || 'Unknown NPC') === selectedNPC)
      .map(([name]) => name);
  }, [isProjectMode, selectedNPC, dialogIndex, semanticModel.dialogs]);

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

  // -------------------------------------------------------------------------
  // Delete dialog state
  // -------------------------------------------------------------------------
  const [deleteDialogTarget, setDeleteDialogTarget] = useState<string | null>(null);

  const deleteDialogInfo = useMemo(() => {
    if (!deleteDialogTarget) return null;
    const model = semanticModel;
    const dialog = model.dialogs?.[deleteDialogTarget];
    if (!dialog) return null;

    // Compute functions to delete (same logic as fileStore.removeDialog)
    const infoRef = dialog.properties?.information;
    const infoFuncName = typeof infoRef === 'string' ? infoRef : (infoRef as any)?.name;
    const condRef = dialog.properties?.condition;
    const condFuncName = typeof condRef === 'string' ? condRef : (condRef as any)?.name;

    const candidates = new Set<string>();
    if (infoFuncName) {
      const q: string[] = [infoFuncName];
      while (q.length > 0) {
        const n = q.pop()!;
        if (candidates.has(n)) continue;
        const f = model.functions?.[n];
        if (!f) continue;
        candidates.add(n);
        for (const action of (f.actions || []) as any[]) {
          if (action.type === 'Choice' && typeof action.targetFunction === 'string') {
            if (!candidates.has(action.targetFunction)) q.push(action.targetFunction);
          }
        }
      }
    }
    if (condFuncName) candidates.add(condFuncName);

    const remainingDialogs = Object.entries(model.dialogs || {})
      .filter(([n]) => n !== deleteDialogTarget)
      .map(([, d]) => d);
    const stillReferenced = new Set<string>();
    for (const d of remainingDialogs) {
      const iRef = d.properties?.information;
      const iName = typeof iRef === 'string' ? iRef : (iRef as any)?.name;
      if (iName) {
        const q: string[] = [iName];
        while (q.length > 0) {
          const n = q.pop()!;
          if (stillReferenced.has(n)) continue;
          const f = model.functions?.[n];
          if (!f) continue;
          stillReferenced.add(n);
          for (const action of (f.actions || []) as any[]) {
            if (action.type === 'Choice' && typeof action.targetFunction === 'string') {
              if (!stillReferenced.has(action.targetFunction)) q.push(action.targetFunction);
            }
          }
        }
      }
      const cRef = d.properties?.condition;
      const cName = typeof cRef === 'string' ? cRef : (cRef as any)?.name;
      if (cName) stillReferenced.add(cName);
    }

    const functionsToDelete = [...candidates].filter((n) => !stillReferenced.has(n));

    // Find broken NpcKnowsInfo references
    const brokenRefs: Array<{ functionName: string }> = [];
    for (const [funcName, func] of Object.entries(model.functions || {})) {
      for (const cond of (func.conditions || []) as any[]) {
        if (cond.type === 'NpcKnowsInfoCondition' && cond.dialogRef === deleteDialogTarget) {
          brokenRefs.push({ functionName: funcName });
          break;
        }
      }
    }

    return {
      description: typeof dialog.properties?.description === 'string' ? dialog.properties.description : undefined,
      functionsToDelete,
      brokenReferences: brokenRefs,
    };
  }, [deleteDialogTarget, semanticModel]);

  const handleDeleteDialogRequest = useCallback((dialogName: string) => {
    setDeleteDialogTarget(dialogName);
  }, []);

  const handleDeleteDialogConfirm = useCallback(() => {
    if (!deleteDialogTarget) return;
    const targetFilePath = filePath || activeFile;
    if (!targetFilePath) return;

    historyActions.removeDialog(targetFilePath, deleteDialogTarget);

    // Remove from recent tabs (and navigate to fallback tab if it was active)
    const deletedNpcName =
      semanticModel.dialogs?.[deleteDialogTarget]?.properties?.npc || selectedNPC || 'Unknown NPC';
    const nextTab = closeRecentDialog(deleteDialogTarget, deletedNpcName, selectedDialog, activeNpcName);

    const { selectedDialog: selDialog, setSelectedDialog, setSelectedFunctionName } = useUISelectionStore.getState();
    if (nextTab) {
      void handleSelectRecentDialog(nextTab.dialogName, nextTab.functionName, nextTab.npcName);
    } else if (selDialog === deleteDialogTarget) {
      setSelectedDialog(null);
      setSelectedFunctionName(null);
    }

    setDeleteDialogTarget(null);
  }, [deleteDialogTarget, filePath, activeFile, semanticModel.dialogs, selectedNPC, selectedDialog, activeNpcName, closeRecentDialog, handleSelectRecentDialog]);

  const handleDeleteDialogCancel = useCallback(() => {
    setDeleteDialogTarget(null);
  }, []);

  // -------------------------------------------------------------------------
  // Rename dialog state
  // -------------------------------------------------------------------------
  const [renameDialogTarget, setRenameDialogTarget] = useState<string | null>(null);
  const [renameNewName, setRenameNewName] = useState('');
  const [renameValidationError, setRenameValidationError] = useState<string | null>(null);

  const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

  const validateRenameNewName = useCallback((oldName: string, newName: string): string | null => {
    if (!newName.trim()) return 'Name cannot be empty';
    if (!IDENTIFIER_PATTERN.test(newName.trim())) {
      return 'Name must be a valid identifier (letters, digits, underscores; cannot start with a digit)';
    }
    if (newName.trim() === oldName) return null;
    if (semanticModel.dialogs?.[newName.trim()]) {
      return `A dialog named "${newName.trim()}" already exists`;
    }
    if (semanticModel.functions?.[newName.trim()]) {
      return `A function named "${newName.trim()}" already exists`;
    }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semanticModel.dialogs, semanticModel.functions]);

  const renameFunctionEntries = useMemo((): FunctionRenameEntry[] => {
    if (!renameDialogTarget || !renameNewName.trim()) return [];
    const newName = renameNewName.trim();
    if (newName === renameDialogTarget) return [];
    const model = semanticModel;
    const dialog = model.dialogs?.[renameDialogTarget];
    if (!dialog) return [];

    const infoRef = dialog.properties?.information;
    const infoFuncName = typeof infoRef === 'string' ? infoRef : (infoRef as any)?.name;
    const condRef = dialog.properties?.condition;
    const condFuncName = typeof condRef === 'string' ? condRef : (condRef as any)?.name;

    const reachable = new Set<string>();
    if (infoFuncName) {
      const q: string[] = [infoFuncName];
      while (q.length > 0) {
        const n = q.pop()!;
        if (reachable.has(n)) continue;
        const f = model.functions?.[n];
        if (!f) continue;
        reachable.add(n);
        for (const action of (f.actions || []) as any[]) {
          if (action.type === 'Choice' && typeof action.targetFunction === 'string') {
            if (!reachable.has(action.targetFunction)) q.push(action.targetFunction);
          }
        }
      }
    }
    if (condFuncName) reachable.add(condFuncName);

    const entries: FunctionRenameEntry[] = [];
    for (const name of reachable) {
      if (name.startsWith(renameDialogTarget)) {
        const suffix = name.slice(renameDialogTarget.length);
        entries.push({ oldName: name, newName: newName + suffix });
      }
    }
    return entries;
  }, [renameDialogTarget, renameNewName, semanticModel]);

  const handleRenameDialogRequest = useCallback((dialogName: string) => {
    setRenameDialogTarget(dialogName);
    setRenameNewName(dialogName);
    setRenameValidationError(null);
  }, []);

  const handleRenameNewNameChange = useCallback((name: string) => {
    setRenameNewName(name);
    if (renameDialogTarget) {
      setRenameValidationError(validateRenameNewName(renameDialogTarget, name));
    }
  }, [renameDialogTarget, validateRenameNewName]);

  const handleRenameDialogConfirm = useCallback(() => {
    if (!renameDialogTarget) return;
    const newName = renameNewName.trim();
    const err = validateRenameNewName(renameDialogTarget, newName);
    if (err) { setRenameValidationError(err); return; }
    if (newName === renameDialogTarget) { setRenameDialogTarget(null); return; }

    const targetFilePath = filePath || activeFile;
    if (!targetFilePath) return;

    historyActions.renameDialog(targetFilePath, renameDialogTarget, newName, true);

    // Update the recent tab in-place with the new name
    const renamedNpcName =
      semanticModel.dialogs?.[renameDialogTarget]?.properties?.npc || selectedNPC || 'Unknown NPC';
    renameRecentDialog(renameDialogTarget, renamedNpcName, newName);

    // Switch to the renamed dialog; pass null so the editor derives the info function
    // from the dialog's updated properties (the old function names no longer exist).
    finalizeDialogSelection(newName, null);

    setRenameDialogTarget(null);
  }, [renameDialogTarget, renameNewName, validateRenameNewName, filePath, activeFile, semanticModel.dialogs, selectedNPC, renameRecentDialog, finalizeDialogSelection]);

  const handleRenameDialogCancel = useCallback(() => {
    setRenameDialogTarget(null);
  }, []);

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
      <NpcColumn
        isProjectMode={isProjectMode}
        projectNpcs={projectNpcs}
        dialogIndex={dialogIndex}
        semanticModelDialogs={semanticModel.dialogs}
        selectedNPC={selectedNPC}
        onSelectNPC={handleSelectNPC}
        onAddNpc={handleAddNpc}
      />

      {/* Column 2: Dialog Tree with Nested Choices */}
      <DialogTreeColumn
        isProjectMode={isProjectMode}
        selectedNPC={selectedNPC}
        selectedDialog={selectedDialog}
        selectedFunctionName={selectedFunctionName}
        dialogsForNPC={dialogsForNPC}
        deferredSemanticModel={deferredSemanticModel}
        expandedDialogs={expandedDialogs}
        buildFunctionTree={buildFunctionTree}
        onSelectDialog={handleSelectDialog}
        onToggleDialogExpand={handleToggleDialogExpand}
        onAddDialog={handleAddDialog}
        dialogIndex={dialogIndex}
        parsedFiles={parsedFiles}
        setIngestedFilesOpen={setIngestedFilesOpen}
      />

      {/* Delete dialog confirmation */}
      {deleteDialogTarget && deleteDialogInfo && (
        <DeleteDialogConfirmDialog
          open={true}
          dialogName={deleteDialogTarget}
          description={deleteDialogInfo.description}
          functionsToDelete={deleteDialogInfo.functionsToDelete}
          brokenReferences={deleteDialogInfo.brokenReferences}
          onConfirm={handleDeleteDialogConfirm}
          onCancel={handleDeleteDialogCancel}
        />
      )}

      {/* Rename dialog confirmation */}
      {renameDialogTarget && (
        <RenameDialogConfirmDialog
          open={true}
          oldDialogName={renameDialogTarget}
          newDialogName={renameNewName}
          validationError={renameValidationError ?? undefined}
          functionRenames={renameFunctionEntries}
          crossFileWarnings={[]}
          onConfirm={handleRenameDialogConfirm}
          onCancel={handleRenameDialogCancel}
          onNewNameChange={handleRenameNewNameChange}
        />
      )}

      {/* Column 3: Function Action Editor */}
      <EditorColumn
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
        onDeleteDialog={handleDeleteDialogRequest}
        onRenameDialog={handleRenameDialogRequest}
      />
    </Box>
  );
};

export default ThreeColumnLayout;
