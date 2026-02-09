import React, { useState, useCallback, useMemo, useTransition, useRef, useEffect, useDeferredValue } from 'react';
import { Box, Typography, Alert, Button } from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { useSearchStore, SearchResult } from '../store/searchStore';
import { useNavigation } from '../hooks/useNavigation';
import NPCList from './NPCList';
import DialogTree from './DialogTree';
import EditorPane from './EditorPane';
import SyntaxErrorsDisplay from './SyntaxErrorsDisplay';
import SearchPanel from './SearchPanel';
import type { SemanticModel, FunctionTreeNode, FunctionTreeChild, ChoiceAction } from '../types/global';

interface ThreeColumnLayoutProps {
  filePath: string | null;
}

const ThreeColumnLayout: React.FC<ThreeColumnLayoutProps> = ({ filePath }) => {
  const { 
    openFiles, 
    openFile,
    activeFile,
    updateModel,
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
    selectedNpc: projectSelectedNpc,
    getSelectedNpcDialogs,
    getSemanticModel,
    mergedSemanticModel,
    loadAndMergeNpcModels,
    setIngestedFilesOpen
  } = useProjectStore();
  const { navigateToDialog } = useNavigation();
  const fileState = filePath ? openFiles.get(filePath) : null;

  const [expandedDialogs, setExpandedDialogs] = useState<Set<string>>(new Set());
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set()); // Track expanded choice nodes
  const [isPending, startTransition] = useTransition(); // Bug #3 fix: correct destructuring
  void isPending;
  const [isLoadingDialog, setIsLoadingDialog] = useState(false); // Immediate loading state
  const [isSearchOpen, setIsSearchOpen] = useState(false); // Search panel visibility
  const editorScrollRef = useRef<HTMLDivElement>(null); // Ref to scroll container

  // Cache for buildFunctionTree to prevent exponential recomputation
  const functionTreeCacheRef = useRef<Map<string, FunctionTreeNode | null>>(new Map());

  // Refs to track RAF IDs for cleanup (Bug #1 fix)
  const rafId1Ref = useRef<number | null>(null);
  const rafId2Ref = useRef<number | null>(null);

  // Max cache size to prevent unbounded growth (Bug #4 fix)
  const MAX_CACHE_SIZE = 1000;

  // Determine which mode we're in: project mode or single-file mode
  const isProjectMode = !!projectPath;
  const semanticModel = isProjectMode ? mergedSemanticModel : (fileState?.semanticModel || {});

  // Defer the semantic model update for the heavy tree view to prevent blocking the main thread
  const deferredSemanticModel = useDeferredValue(semanticModel);

  // Determine early return conditions (but don't return yet - hooks must be called first)
  const showLoading = !isProjectMode && !fileState;
  const showSyntaxErrors = fileState?.hasErrors && !fileState?.autoSaveError;

  // Log parse errors for the selected NPC to the console (for easy debugging)
  useEffect(() => {
    if (!isProjectMode) return;
    if (!selectedNPC) return;
    if (!semanticModel.hasErrors) return;

    const errors = semanticModel.errors || [];
    console.error(
      `[Dialog Parse Errors] NPC=${selectedNPC} count=${errors.length}`,
      errors
    );
  }, [isProjectMode, selectedNPC, semanticModel.hasErrors, semanticModel.errors]);

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

  // LRU cache helpers (Bug #4 fix)
  const lruCacheGet = useCallback((key: string): FunctionTreeNode | null | undefined => {
    const cache = functionTreeCacheRef.current;
    if (!cache.has(key)) return undefined;

    // Move to end (most recently used)
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value!);
    return value;
  }, []);

  const lruCacheSet = useCallback((key: string, value: FunctionTreeNode | null): void => {
    const cache = functionTreeCacheRef.current;

    // Remove old position if exists
    if (cache.has(key)) {
      cache.delete(key);
    }

    // Add at end (most recent)
    cache.set(key, value);

    // Evict oldest if over limit
    if (cache.size > MAX_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
  }, [MAX_CACHE_SIZE]);

  // Build function tree for a given function (recursively find choices)
  // ancestorPath tracks the path from root to current node to prevent direct cycles
  // Uses memoization to prevent exponential recomputation in diamond patterns
  // Uses deferred functions to avoid re-calculating the tree on every keystroke
  const deferredFunctions = deferredSemanticModel.functions;
  const buildFunctionTree = useCallback((funcName: string, ancestorPath: string[] = []): FunctionTreeNode | null => {
    // Prevent direct cycles (A -> B -> A), but allow diamonds (A -> B, A -> C, both -> D)
    if (ancestorPath.includes(funcName)) {
      return null; // Direct cycle detected
    }

    // Create cache key including ancestor path to handle different contexts
    const cacheKey = `${funcName}|${ancestorPath.join(',')}`;

    const func = deferredFunctions?.[funcName];
    if (!func) return null;

    // Check cache first (LRU - Bug #4 fix)
    // PERFORMANCE OPTIMIZATION: Lazy Verification
    // Instead of clearing the entire cache when semanticModel changes, we verify if the cached node is still valid.
    const cached = lruCacheGet(cacheKey);
    if (cached !== undefined && cached !== null) {
      // 1. Fast Path: Reference equality (Same model or same object)
      if (cached.function === func) {
        return cached;
      }

      // 2. Optimization: Content equality
      // Check if function definition is identical (using JSON.stringify for deep comparison)
      if (JSON.stringify(func) === JSON.stringify(cached.function)) {
        // Function definition is same, but children might have changed (if their functions changed)
        // We must verify children subtrees recursively.
        const newPath = [...ancestorPath, funcName];
        let childrenChanged = false;

        const newChildren = cached.children
          .map((child) => {
            const newSubtree = buildFunctionTree(child.targetFunction, newPath);
            // Reference comparison: if subtree changed, it returns a new object
            if (newSubtree !== child.subtree) {
              childrenChanged = true;
              return { ...child, subtree: newSubtree };
            }
            return child;
          })
          .filter((child) => child.subtree !== null);

        // If all children are identical to cached version, return cached node
        if (!childrenChanged) {
          // Update the cached function reference to the new one to hit fast path next time!
          const updatedNode = { ...cached, function: func };
          lruCacheSet(cacheKey, updatedNode);
          return updatedNode;
        }

        // If children changed, create new node but avoid reparsing actions
        const newNode: FunctionTreeNode = {
          ...cached,
          function: func, // Update function ref
          children: newChildren
        };
        lruCacheSet(cacheKey, newNode);
        return newNode;
      }
    }

    // Filter actions that are choices (have dialogRef and targetFunction)
    const choices = (func.actions || []).filter((action): action is ChoiceAction =>
      'dialogRef' in action && 'targetFunction' in action
    );

    const newPath = [...ancestorPath, funcName];

    // Pre-compute isShared for all choices at once (O(n) instead of O(n²))
    const targetCounts = new Map<string, number>();
    choices.forEach((choice) => {
      const target = choice.targetFunction;
      targetCounts.set(target, (targetCounts.get(target) || 0) + 1);
    });

    const children: FunctionTreeChild[] = choices
      .map((choice) => {
        const subtree = buildFunctionTree(choice.targetFunction, newPath);
        return {
          text: choice.text || '(no text)',
          targetFunction: choice.targetFunction,
          subtree: subtree,
          isShared: (targetCounts.get(choice.targetFunction) || 0) > 1
        };
      })
      .filter((c): c is FunctionTreeChild => c.subtree !== null);

    const result: FunctionTreeNode = {
      name: funcName,
      function: func,
      children
    };

    // Cache the result (LRU - Bug #4 fix)
    lruCacheSet(cacheKey, result);

    return result;
  }, [deferredFunctions, lruCacheGet, lruCacheSet]);

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
  const dialogInfoFunctionName = typeof infoFunction === 'string' ? infoFunction : (infoFunction as { name?: string })?.name;

  // Get the currently selected function (either dialog info or choice function)
  const currentFunctionName = selectedFunctionName || dialogInfoFunctionName;
  const currentFunctionData = currentFunctionName ? semanticModel.functions?.[currentFunctionName] : null;

  const handleSelectNPC = async (npc: string) => {
    setSelectedDialog(null);
    setSelectedFunctionName(null);

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
  };

  const handleSelectDialog = useCallback(async (dialogName: string, functionName: string | null) => {
    // Cancel any pending RAF callbacks from previous dialog selection (Bug #1 fix)
    if (rafId1Ref.current !== null) {
      cancelAnimationFrame(rafId1Ref.current);
      rafId1Ref.current = null;
    }
    if (rafId2Ref.current !== null) {
      cancelAnimationFrame(rafId2Ref.current);
      rafId2Ref.current = null;
    }

    // In project mode, ensure the file containing this dialog is opened in editorStore
    // so that it can be edited (DialogDetailsEditor requires a filePath in openFiles)
    if (isProjectMode && selectedNPC) {
      const npcDialogs = dialogIndex.get(selectedNPC);
      const metadata = npcDialogs?.find(d => d.dialogName === dialogName);
      if (metadata && metadata.filePath && activeFile !== metadata.filePath) {
        await openFile(metadata.filePath);
      }
    }

    // Show loading immediately to prevent flickering
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
          setIsLoadingDialog(false);
          // Clear refs after execution
          rafId1Ref.current = null;
          rafId2Ref.current = null;
        });
      });
    });
  }, [isProjectMode, selectedNPC, dialogIndex, activeFile, openFile, setSelectedDialog, setSelectedFunctionName]);

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
      await navigateToDialog(result.dialogName);
      return;
    }

    // For function or text results, try to navigate to the function
    if (result.functionName) {
      // Try to find which dialog this function belongs to
      const dialogs = semanticModel.dialogs || {};
      for (const [dialogName, dialog] of Object.entries(dialogs)) {
        const infoFunc = dialog.properties?.information as any;
        const infoFuncName = typeof infoFunc === 'string' ? infoFunc : infoFunc?.name;

        if (infoFuncName === result.functionName) {
          await navigateToDialog(dialogName);
          return;
        }
      }

      // If not found as a direct dialog function, just navigate to the function
      setSelectedFunctionName(result.functionName);
    }
  }, [selectedNPC, semanticModel, handleSelectNPC, navigateToDialog]);

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
      />

      {/* Column 2: Dialog Tree with Nested Choices */}
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: '0 0 350px', overflow: 'hidden' }}>
        {/* Error Alert for Parsing Errors */}
        {isProjectMode && semanticModel.hasErrors && (
          <Alert severity="error" sx={{ borderRadius: 0, flexShrink: 0 }}>
            <Typography variant="body2" gutterBottom>
              Failed to parse dialog file(s) for {selectedNPC}
            </Typography>
            <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
              {semanticModel.errors?.length || 0} error(s) found. Open the file list (top bar list icon) for full details.
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setIngestedFilesOpen(true)}
              sx={{ mb: 0.5 }}
            >
              View details
            </Button>
            {(semanticModel.errors || []).slice(0, 3).map((err, index) => (
              <Typography key={index} variant="caption" display="block" sx={{ whiteSpace: 'pre-wrap' }}>
                - {err.message}
              </Typography>
            ))}
            {(semanticModel.errors?.length || 0) > 3 && (
              <Typography variant="caption" display="block" sx={{ fontStyle: 'italic' }}>
                ...and {(semanticModel.errors?.length || 0) - 3} more
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
        isProjectMode={isProjectMode}
        isLoadingDialog={isLoadingDialog}
        onNavigateToFunction={handleNavigateToFunction}
      />
    </Box>
  );
};

export default ThreeColumnLayout;
