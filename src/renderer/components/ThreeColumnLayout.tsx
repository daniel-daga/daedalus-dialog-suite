import React, { useState, useCallback, useMemo, useTransition, useRef, useEffect } from 'react';
import { Box, Typography, Alert, Paper, List, ListItem, ListItemText, Fade } from '@mui/material';
import { useEditorStore } from '../store/editorStore';
import NPCList from './NPCList';
import DialogTree from './DialogTree';
import DialogDetailsEditor from './DialogDetailsEditor';
import DialogLoadingSkeleton from './DialogLoadingSkeleton';

interface ThreeColumnLayoutProps {
  filePath: string;
}

const ThreeColumnLayout: React.FC<ThreeColumnLayoutProps> = ({ filePath }) => {
  const { openFiles, updateModel } = useEditorStore();
  const fileState = openFiles.get(filePath);

  const [selectedNPC, setSelectedNPC] = useState<string | null>(null);
  const [selectedDialog, setSelectedDialog] = useState<string | null>(null);
  const [selectedFunctionName, setSelectedFunctionName] = useState<string | null>(null); // Can be dialog info function or choice function
  const [expandedDialogs, setExpandedDialogs] = useState<Set<string>>(new Set());
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set()); // Track expanded choice nodes
  const [isPending, startTransition] = useTransition(); // Bug #3 fix: correct destructuring
  const [isLoadingDialog, setIsLoadingDialog] = useState(false); // Immediate loading state
  const editorScrollRef = useRef<HTMLDivElement>(null); // Ref to scroll container

  // Cache for buildFunctionTree to prevent exponential recomputation
  const functionTreeCacheRef = useRef<Map<string, any>>(new Map());

  // Refs to track RAF IDs for cleanup (Bug #1 fix)
  const rafId1Ref = useRef<number | null>(null);
  const rafId2Ref = useRef<number | null>(null);

  // Ref to track previous semantic model for cache invalidation (Bug #2 fix)
  const prevSemanticModelRef = useRef<any>(null);

  // Max cache size to prevent unbounded growth (Bug #4 fix)
  const MAX_CACHE_SIZE = 1000;

  if (!fileState) {
    return <Typography>Loading...</Typography>;
  }

  // Check for syntax errors - if present, show error display instead of editor
  if (fileState.hasErrors) {
    return (
      <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            Syntax Errors Detected
          </Typography>
          <Typography variant="body2">
            This file contains syntax errors and cannot be edited until they are fixed.
            Please correct the errors in a text editor and reload the file.
          </Typography>
        </Alert>

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Error Details:
          </Typography>
          <List>
            {(fileState.errors || []).map((error, index) => (
              <ListItem key={index} sx={{ flexDirection: 'column', alignItems: 'flex-start', borderBottom: '1px solid', borderColor: 'divider' }}>
                <ListItemText
                  primary={error.message}
                  secondary={
                    <>
                      <Typography component="span" variant="body2" color="text.secondary">
                        Type: {error.type}
                      </Typography>
                      {error.position && (
                        <>
                          <br />
                          <Typography component="span" variant="body2" color="text.secondary">
                            Location: Line {error.position.row}, Column {error.position.column}
                          </Typography>
                        </>
                      )}
                      {error.text && (
                        <>
                          <br />
                          <Typography component="span" variant="body2" color="error" sx={{ fontFamily: 'monospace', mt: 1, display: 'block' }}>
                            {error.text}
                          </Typography>
                        </>
                      )}
                    </>
                  }
                />
              </ListItem>
            ))}
          </List>
        </Paper>

        <Box sx={{ mt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            File path: {filePath}
          </Typography>
        </Box>
      </Box>
    );
  }

  const { semanticModel } = fileState;

  // Clear cache synchronously when semantic model changes (Bug #2 fix)
  // This must happen BEFORE buildFunctionTree is called during render
  if (semanticModel !== prevSemanticModelRef.current) {
    functionTreeCacheRef.current.clear();
    prevSemanticModelRef.current = semanticModel;
  }

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
  const lruCacheGet = useCallback((key: string): any => {
    const cache = functionTreeCacheRef.current;
    if (!cache.has(key)) return undefined;

    // Move to end (most recently used)
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }, []);

  const lruCacheSet = useCallback((key: string, value: any): void => {
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
      cache.delete(oldestKey);
    }
  }, [MAX_CACHE_SIZE]);

  // Build function tree for a given function (recursively find choices)
  // ancestorPath tracks the path from root to current node to prevent direct cycles
  // Uses memoization to prevent exponential recomputation in diamond patterns
  const buildFunctionTree = useCallback((funcName: string, ancestorPath: string[] = []): any => {
    // Prevent direct cycles (A -> B -> A), but allow diamonds (A -> B, A -> C, both -> D)
    if (ancestorPath.includes(funcName)) {
      return null; // Direct cycle detected
    }

    // Create cache key including ancestor path to handle different contexts
    const cacheKey = `${funcName}|${ancestorPath.join(',')}`;

    // Check cache first (LRU - Bug #4 fix)
    const cached = lruCacheGet(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const func = semanticModel.functions?.[funcName];
    if (!func) return null;

    const choices = (func.actions || []).filter((action: any) =>
      action.dialogRef !== undefined && action.targetFunction !== undefined
    );

    const newPath = [...ancestorPath, funcName];

    // Pre-compute isShared for all choices at once (O(n) instead of O(n²))
    const targetCounts = new Map<string, number>();
    choices.forEach((choice: any) => {
      const target = choice.targetFunction;
      targetCounts.set(target, (targetCounts.get(target) || 0) + 1);
    });

    const result = {
      name: funcName,
      function: func,
      children: choices.map((choice: any) => {
        const subtree = buildFunctionTree(choice.targetFunction, newPath);
        return {
          text: choice.text || '(no text)',
          targetFunction: choice.targetFunction,
          subtree: subtree,
          isShared: (targetCounts.get(choice.targetFunction) || 0) > 1
        };
      }).filter((c: any) => c.subtree !== null)
    };

    // Cache the result (LRU - Bug #4 fix)
    lruCacheSet(cacheKey, result);

    return result;
  }, [semanticModel, lruCacheGet, lruCacheSet]);

  // Memoize NPC map extraction to avoid rebuilding on every render
  const { npcMap, npcs } = useMemo(() => {
    const map = new Map<string, string[]>();
    Object.entries(semanticModel.dialogs || {}).forEach(([dialogName, dialog]: [string, any]) => {
      const npcName = dialog.properties?.npc || 'Unknown NPC';
      if (!map.has(npcName)) {
        map.set(npcName, []);
      }
      map.get(npcName)!.push(dialogName);
    });

    const npcList = Array.from(map.keys()).sort();

    return { npcMap: map, npcs: npcList };
  }, [semanticModel.dialogs]);

  // Get dialogs for selected NPC
  const dialogsForNPC = selectedNPC ? (npcMap.get(selectedNPC) || []) : [];

  // Get selected dialog data
  const dialogData = selectedDialog ? semanticModel.dialogs?.[selectedDialog] : null;

  // Get the information function for the selected dialog
  const infoFunction = dialogData?.properties?.information as any;
  const dialogInfoFunctionName = typeof infoFunction === 'string' ? infoFunction : infoFunction?.name;

  // Get the currently selected function (either dialog info or choice function)
  const currentFunctionName = selectedFunctionName || dialogInfoFunctionName;
  const currentFunctionData = currentFunctionName ? semanticModel.functions?.[currentFunctionName] : null;

  const handleSelectNPC = (npc: string) => {
    setSelectedNPC(npc);
    setSelectedDialog(null);
  };

  const handleSelectDialog = (dialogName: string, functionName: string | null) => {
    // Cancel any pending RAF callbacks from previous dialog selection (Bug #1 fix)
    if (rafId1Ref.current !== null) {
      cancelAnimationFrame(rafId1Ref.current);
      rafId1Ref.current = null;
    }
    if (rafId2Ref.current !== null) {
      cancelAnimationFrame(rafId2Ref.current);
      rafId2Ref.current = null;
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
  };

  const handleToggleDialogExpand = (dialogName: string) => {
    setExpandedDialogs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(dialogName)) {
        newSet.delete(dialogName);
      } else {
        newSet.add(dialogName);
      }
      return newSet;
    });
  };

  const handleToggleChoiceExpand = (choiceKey: string) => {
    setExpandedChoices((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(choiceKey)) {
        newSet.delete(choiceKey);
      } else {
        newSet.add(choiceKey);
      }
      return newSet;
    });
  };

  const handleNavigateToFunction = (functionName: string) => {
    // Navigate to the choice function
    setSelectedFunctionName(functionName);
    // Optionally expand the dialog tree to show the choice
    if (selectedDialog) {
      setExpandedDialogs((prev) => new Set([...prev, selectedDialog]));
    }
  };

  return (
    <Box sx={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Column 1: NPC List */}
      <NPCList
        npcs={npcs}
        npcMap={npcMap}
        selectedNPC={selectedNPC}
        onSelectNPC={handleSelectNPC}
      />

      {/* Column 2: Dialog Tree with Nested Choices */}
      <DialogTree
        selectedNPC={selectedNPC}
        dialogsForNPC={dialogsForNPC}
        semanticModel={semanticModel}
        selectedDialog={selectedDialog}
        selectedFunctionName={selectedFunctionName}
        expandedDialogs={expandedDialogs}
        expandedChoices={expandedChoices}
        onSelectDialog={handleSelectDialog}
        onToggleDialogExpand={handleToggleDialogExpand}
        onToggleChoiceExpand={handleToggleChoiceExpand}
        buildFunctionTree={buildFunctionTree}
      />

      {/* Column 3: Function Action Editor */}
      <Box ref={editorScrollRef} sx={{ flex: '1 1 auto', overflow: 'auto', p: 2, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {selectedDialog && dialogData ? (
          !currentFunctionName ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Alert severity="warning">
                <Typography variant="body2">
                  This dialog does not have an information function defined.
                </Typography>
              </Alert>
            </Box>
          ) : !currentFunctionData ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Alert severity="error">
                <Typography variant="body2">
                  Function "{currentFunctionName}" not found in the file.
                </Typography>
              </Alert>
            </Box>
          ) : (
          <>
            {/* Show loading skeleton during transition - positioned relative to this box */}
            <Fade in={isLoadingDialog} unmountOnExit timeout={{ enter: 100, exit: 200 }}>
              <Box sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                p: 2,
                bgcolor: 'background.default',
                zIndex: 10,
                overflow: 'hidden'
              }}>
                <DialogLoadingSkeleton />
              </Box>
            </Fade>

            {/* Show actual content - hidden when loading */}
            <Box sx={{ width: '100%', opacity: isLoadingDialog ? 0 : 1, transition: 'opacity 0.2s' }}>
              <DialogDetailsEditor
                dialogName={selectedDialog}
                filePath={filePath}
                functionName={selectedFunctionName || undefined}
                onNavigateToFunction={handleNavigateToFunction}
              />
            </Box>
          </>
          )
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="body1" color="text.secondary">
              Select a dialog to edit
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ThreeColumnLayout;
