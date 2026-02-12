import React, { useState, useCallback, useMemo, useTransition, useRef, useEffect, useDeferredValue } from 'react';
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
import { generateActionId } from './actionFactory';
import type { SemanticModel, FunctionTreeNode, FunctionTreeChild, ChoiceAction, Dialog, DialogFunction } from '../types/global';

interface ThreeColumnLayoutProps {
  filePath: string | null;
}

interface RecentDialogTab {
  dialogName: string;
  npcName: string;
  functionName: string | null;
}

function normalizeIdentifier(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    return fallback;
  }

  return /^[0-9]/.test(normalized) ? `N_${normalized}` : normalized;
}

function makeUniqueName(baseName: string, existing: Set<string>): string {
  if (!existing.has(baseName)) {
    return baseName;
  }

  let suffix = 1;
  let candidate = `${baseName}_${suffix}`;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${baseName}_${suffix}`;
  }

  return candidate;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/');
}

function getDirectoryName(pathValue: string): string {
  const normalized = normalizePath(pathValue);
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
}

function joinPath(directory: string, fileName: string): string {
  if (!directory) {
    return fileName;
  }

  const normalized = normalizePath(directory).replace(/\/+$/g, '');
  return `${normalized}/${fileName}`;
}

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
    setIngestedFilesOpen,
    parsedFiles,
    allDialogFiles
  } = useProjectStore();
  const { navigateToDialog } = useNavigation();
  const fileState = filePath ? openFiles.get(filePath) : null;

  const [expandedDialogs, setExpandedDialogs] = useState<Set<string>>(new Set());
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set()); // Track expanded choice nodes
  const [isPending, startTransition] = useTransition(); // Bug #3 fix: correct destructuring
  void isPending;
  const [isLoadingDialog, setIsLoadingDialog] = useState(false); // Immediate loading state
  const [isSearchOpen, setIsSearchOpen] = useState(false); // Search panel visibility
  const [recentDialogs, setRecentDialogs] = useState<RecentDialogTab[]>([]);
  const editorScrollRef = useRef<HTMLDivElement>(null); // Ref to scroll container

  // Cache for buildFunctionTree to prevent exponential recomputation
  const functionTreeCacheRef = useRef<Map<string, FunctionTreeNode | null>>(new Map());

  // Refs to track RAF IDs for cleanup (Bug #1 fix)
  const rafId1Ref = useRef<number | null>(null);
  const rafId2Ref = useRef<number | null>(null);
  const dialogTransitionIdRef = useRef(0);
  const loadingTimeoutRef = useRef<number | null>(null);

  // Max cache size to prevent unbounded growth (Bug #4 fix)
  const MAX_CACHE_SIZE = 1000;
  const MAX_RECENT_DIALOGS = 10;

  // Determine which mode we're in: project mode or single-file mode
  const isProjectMode = !!projectPath;
  const semanticModel = isProjectMode ? mergedSemanticModel : (fileState?.semanticModel || {});

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
      if (loadingTimeoutRef.current !== null) {
        clearTimeout(loadingTimeoutRef.current);
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
    if (loadingTimeoutRef.current !== null) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }

    // Show loading immediately to prevent flickering
    setIsLoadingDialog(true);

    const loadingStartTime = performance.now();
    const MIN_LOADING_MS = 180;

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
          const elapsed = performance.now() - loadingStartTime;
          const remaining = Math.max(0, MIN_LOADING_MS - elapsed);

          loadingTimeoutRef.current = window.setTimeout(() => {
            if (dialogTransitionIdRef.current === transitionId) {
              setIsLoadingDialog(false);
            }
            loadingTimeoutRef.current = null;
          }, remaining);

          // Clear refs after execution
          rafId1Ref.current = null;
          rafId2Ref.current = null;
        });
      });
    });
  }, [setSelectedDialog, setSelectedFunctionName]);

  const resolveTargetFilePath = useCallback((npcName: string): string | null => {
    const npcDialogMetadata = dialogIndex.get(npcName) || [];
    if (npcDialogMetadata.length > 0) {
      return npcDialogMetadata[0].filePath;
    }

    if (isProjectMode) {
      const npcToken = normalizeIdentifier(npcName, 'NEW_NPC');
      const defaultFileName = `DIA_${npcToken}.d`;
      const baseDirectory = projectPath
        ? normalizePath(projectPath)
        : getDirectoryName(activeFile || filePath || allDialogFiles[0] || '');

      if (!baseDirectory) {
        return null;
      }

      return joinPath(baseDirectory, defaultFileName);
    }

    if (selectedNPC) {
      const selectedNpcMetadata = dialogIndex.get(selectedNPC) || [];
      if (selectedNpcMetadata.length > 0) {
        return selectedNpcMetadata[0].filePath;
      }
    }

    if (activeFile) {
      return activeFile;
    }

    if (filePath) {
      return filePath;
    }

    return null;
  }, [dialogIndex, isProjectMode, projectPath, activeFile, filePath, allDialogFiles, selectedNPC]);

  const createDialogForNpc = useCallback(async (rawNpcName: string, requestedDialogName?: string) => {
    const npcName = normalizeIdentifier(rawNpcName, 'NEW_NPC');
    const targetFilePath = resolveTargetFilePath(npcName);

    if (!targetFilePath) {
      throw new Error('No target file available. Open a dialog file first.');
    }

    const knownDialogPaths = new Set(allDialogFiles.map((path) => normalizePath(path)));
    const normalizedTargetPath = normalizePath(targetFilePath);
    if (isProjectMode && !knownDialogPaths.has(normalizedTargetPath)) {
      const writeResult = await window.editorAPI.writeFile(targetFilePath, '');
      if (!writeResult?.success) {
        throw new Error(`Could not create NPC dialog file: ${targetFilePath}`);
      }
    }

    if (!openFiles.has(targetFilePath)) {
      await openFile(targetFilePath);
    }

    const latestModel = getFileState(targetFilePath)?.semanticModel;
    if (!latestModel || latestModel.hasErrors) {
      throw new Error('Target file contains syntax errors and cannot be edited.');
    }

    const uniquenessModel = (isProjectMode ? semanticModel : latestModel) as SemanticModel;

    const npcToken = normalizeIdentifier(npcName, 'NEW_NPC');
    const dialogBaseName = requestedDialogName?.trim()
      ? normalizeIdentifier(requestedDialogName, `DIA_${npcToken}_Start`)
      : `DIA_${npcToken}_Start`;
    const prefixedDialogBase = dialogBaseName.startsWith('DIA_')
      ? dialogBaseName
      : `DIA_${dialogBaseName}`;

    const existingDialogNames = new Set<string>([
      ...Object.keys(uniquenessModel.dialogs || {}),
      ...Object.keys(latestModel.dialogs || {})
    ]);
    const dialogName = makeUniqueName(prefixedDialogBase, existingDialogNames);

    const existingFunctionNames = new Set<string>([
      ...Object.keys(uniquenessModel.functions || {}),
      ...Object.keys(latestModel.functions || {})
    ]);
    const infoFunctionName = makeUniqueName(`${dialogName}_Info`, existingFunctionNames);
    existingFunctionNames.add(infoFunctionName);
    const conditionFunctionName = makeUniqueName(`${dialogName}_Condition`, existingFunctionNames);

    const nextNr = Object.values(latestModel.dialogs || {}).reduce((maxNr, dialog) => {
      if (dialog?.properties?.npc !== npcName) {
        return maxNr;
      }
      const nr = typeof dialog.properties?.nr === 'number' ? dialog.properties.nr : 0;
      return Math.max(maxNr, nr);
    }, 0) + 1;

    const newDialog: Dialog = {
      name: dialogName,
      parent: 'C_INFO',
      properties: {
        npc: npcName,
        nr: nextNr,
        condition: conditionFunctionName,
        information: infoFunctionName,
        description: dialogName,
        permanent: false,
        important: false
      }
    };

    const conditionFunction: DialogFunction = {
      name: conditionFunctionName,
      returnType: 'INT',
      actions: [],
      conditions: [],
      calls: []
    };

    const informationFunction: DialogFunction = {
      name: infoFunctionName,
      returnType: 'VOID',
      actions: [
        {
          type: 'DialogLine',
          speaker: 'self',
          text: '',
          id: generateActionId()
        }
      ],
      conditions: [],
      calls: []
    };

    const updatedModel: SemanticModel = {
      ...latestModel,
      dialogs: {
        ...(latestModel.dialogs || {}),
        [dialogName]: newDialog
      },
      functions: {
        ...(latestModel.functions || {}),
        [conditionFunctionName]: conditionFunction,
        [infoFunctionName]: informationFunction
      },
      hasErrors: false,
      errors: latestModel.errors || []
    };

    updateModel(targetFilePath, updatedModel);

    if (isProjectMode) {
      addDialogToIndex({
        dialogName,
        npc: npcName,
        filePath: targetFilePath
      });
      selectNpc(npcName);
      loadAndMergeNpcModels(npcName);
    }

    setSelectedNPC(npcName);
    setExpandedDialogs((prev) => new Set([...prev, dialogName]));
    finalizeDialogSelection(dialogName, infoFunctionName);
  }, [
    resolveTargetFilePath,
    openFiles,
    openFile,
    getFileState,
    allDialogFiles,
    isProjectMode,
    semanticModel,
    updateModel,
    addDialogToIndex,
    selectNpc,
    loadAndMergeNpcModels,
    setSelectedNPC,
    finalizeDialogSelection
  ]);

  const handleAddNpc = useCallback(async (npcName: string) => {
    await createDialogForNpc(npcName);
  }, [createDialogForNpc]);

  const handleAddDialog = useCallback(async (dialogName: string) => {
    if (!selectedNPC) {
      throw new Error('Select an NPC first.');
    }
    await createDialogForNpc(selectedNPC, dialogName);
  }, [selectedNPC, createDialogForNpc]);

  const handleSelectDialog = useCallback(async (dialogName: string, functionName: string | null) => {
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
  }, [isProjectMode, selectedNPC, dialogIndex, activeFile, openFile, finalizeDialogSelection]);

  const addRecentDialog = useCallback((dialogName: string, npcName: string, functionName: string | null) => {
    setRecentDialogs((prev) => {
      const existingIndex = prev.findIndex((tab) => tab.dialogName === dialogName && tab.npcName === npcName);

      // Keep tab order stable to avoid janky horizontal reflow when selecting.
      // Only update metadata for existing tabs; append only when it's a newly opened dialog.
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = { ...next[existingIndex], functionName };
        return next;
      }

      const next = [...prev, { dialogName, npcName, functionName }];
      if (next.length > MAX_RECENT_DIALOGS) {
        return next.slice(next.length - MAX_RECENT_DIALOGS);
      }
      return next;
    });
  }, [MAX_RECENT_DIALOGS]);

  const handleSelectRecentDialog = useCallback(async (dialogName: string, functionName: string | null, npcName: string) => {
    setIsLoadingDialog(true);

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

    try {
      const navigated = await navigateToDialog(dialogName, functionName ?? undefined);
      if (navigated) {
        finalizeDialogSelection(dialogName, functionName);
      } else {
        setIsLoadingDialog(false);
      }
    } catch (error) {
      console.error('Failed to switch recent dialog tab:', error);
      setIsLoadingDialog(false);
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
    navigateToDialog
  ]);

  useEffect(() => {
    if (!selectedDialog) return;

    const dialog = semanticModel.dialogs?.[selectedDialog];
    if (!dialog) return;

    const npcName = dialog.properties?.npc || selectedNPC || 'Unknown NPC';
    const infoFunction = dialog.properties?.information;
    const infoFunctionName = typeof infoFunction === 'string' ? infoFunction : (infoFunction as { name?: string })?.name;
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
        isProjectMode={isProjectMode}
        isLoadingDialog={isLoadingDialog}
        recentDialogs={recentDialogs}
        onSelectRecentDialog={handleSelectRecentDialog}
        onNavigateToFunction={handleNavigateToFunction}
      />
    </Box>
  );
};

export default ThreeColumnLayout;
