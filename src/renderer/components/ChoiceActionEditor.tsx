import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, List, ListItemButton, ListItemText, IconButton, Chip, Divider, Stack } from '@mui/material';
import { Add as AddIcon, ExpandMore as ExpandMoreIcon, ChevronRight as ChevronRightIcon } from '@mui/icons-material';
import { ChoiceActionEditorProps } from './dialogTypes';
import ActionCard from './ActionCard';
import { generateUniqueChoiceFunctionName, createEmptyFunction } from './dialogUtils';
import { createAction, createActionAfterIndex } from './actionFactory';
import type { ActionTypeId } from './actionTypes';

const ChoiceActionEditor: React.FC<ChoiceActionEditorProps> = ({
  open,
  onClose,
  targetFunctionName,
  targetFunction,
  onUpdateFunction,
  npcName,
  semanticModel,
  onUpdateSemanticFunction
}) => {
  // Navigation state - which function we're currently viewing/editing
  const [currentFunctionName, setCurrentFunctionName] = useState(targetFunctionName);
  const [localFunctions, setLocalFunctions] = useState<{[key: string]: any}>({});
  const actionRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set([targetFunctionName]));

  // Initialize local functions state
  React.useEffect(() => {
    if (targetFunction && open) {
      setLocalFunctions({ [targetFunctionName]: targetFunction });
      setCurrentFunctionName(targetFunctionName);
      setExpandedNodes(new Set([targetFunctionName]));
    }
  }, [targetFunction, targetFunctionName, open]);

  // Get current function being edited
  const currentFunction = localFunctions[currentFunctionName] || semanticModel?.functions?.[currentFunctionName];

  const focusAction = useCallback((index: number, scrollIntoView = false) => {
    const ref = actionRefs.current[index];
    if (ref) {
      ref.focus();
      if (scrollIntoView) {
        requestAnimationFrame(() => {
          ref.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        });
      }
    }
  }, []);

  const handleSave = () => {
    // Save all modified functions
    Object.entries(localFunctions).forEach(([funcName, func]) => {
      if (funcName === targetFunctionName) {
        onUpdateFunction(func);
      } else {
        onUpdateSemanticFunction(funcName, func);
      }
    });
    onClose();
  };

  const handleRenameFunction = useCallback((oldName: string, newName: string) => {
    // Update local functions map
    setLocalFunctions((prev) => {
      const func = prev[oldName] || semanticModel?.functions?.[oldName];
      if (!func) return prev;

      const updated = { ...prev };
      delete updated[oldName];
      updated[newName] = { ...func, name: newName };
      return updated;
    });

    // Update current function name if we're viewing the renamed function
    if (currentFunctionName === oldName) {
      setCurrentFunctionName(newName);
    }

    // Update semantic model immediately
    onUpdateSemanticFunction(newName, { ...(localFunctions[oldName] || semanticModel?.functions?.[oldName]), name: newName });
  }, [currentFunctionName, localFunctions, semanticModel, onUpdateSemanticFunction]);

  const updateAction = useCallback((index: number, updatedAction: any) => {
    setLocalFunctions((prev) => {
      const func = prev[currentFunctionName] || semanticModel?.functions?.[currentFunctionName];
      if (!func) return prev;
      const newActions = [...(func.actions || [])];
      newActions[index] = updatedAction;
      return {
        ...prev,
        [currentFunctionName]: { ...func, actions: newActions }
      };
    });
  }, [currentFunctionName, semanticModel]);

  const deleteAction = useCallback((index: number) => {
    setLocalFunctions((prev) => {
      const func = prev[currentFunctionName] || semanticModel?.functions?.[currentFunctionName];
      if (!func) return prev;
      const newActions = (func.actions || []).filter((_: any, i: number) => i !== index);
      return {
        ...prev,
        [currentFunctionName]: { ...func, actions: newActions }
      };
    });
  }, [currentFunctionName, semanticModel]);

  const deleteActionAndFocusPrev = useCallback((index: number) => {
    setLocalFunctions((prev) => {
      const func = prev[currentFunctionName] || semanticModel?.functions?.[currentFunctionName];
      if (!func) return prev;
      const newActions = (func.actions || []).filter((_: any, i: number) => i !== index);
      return {
        ...prev,
        [currentFunctionName]: { ...func, actions: newActions }
      };
    });
    const prevIdx = index - 1;
    if (prevIdx >= 0) {
      setTimeout(() => focusAction(prevIdx), 0);
    }
  }, [focusAction, currentFunctionName, semanticModel]);

  const addDialogLineAfter = useCallback((index: number) => {
    setLocalFunctions((prev) => {
      const func = prev[currentFunctionName] || semanticModel?.functions?.[currentFunctionName];
      if (!func) return prev;
      const currentAction = (func.actions || [])[index];
      const oppositeSpeaker = currentAction?.speaker === 'self' ? 'other' : 'self';
      const newAction = {
        speaker: oppositeSpeaker,
        text: '',
        id: 'NEW_LINE_ID'
      };
      const newActions = [...(func.actions || [])];
      newActions.splice(index + 1, 0, newAction);
      return {
        ...prev,
        [currentFunctionName]: { ...func, actions: newActions }
      };
    });
    setTimeout(() => focusAction(index + 1, true), 0);
  }, [focusAction, currentFunctionName, semanticModel]);

  const addActionAfter = useCallback((index: number, actionType: string) => {
    // Handle choice creation specially to generate target function
    if (actionType === 'choice' && semanticModel) {
      // Use currentFunctionName as the base for nested choice function names
      const newFunctionName = generateUniqueChoiceFunctionName(currentFunctionName, semanticModel);
      const newFunction = createEmptyFunction(newFunctionName);

      // Add the new function to local state (will be saved on modal save)
      setLocalFunctions((prev) => ({
        ...prev,
        [newFunctionName]: newFunction
      }));

      // Expand the current node to show the new choice
      setExpandedNodes((prev) => new Set([...prev, currentFunctionName]));

      // Now add the choice action using factory
      setLocalFunctions((prev) => {
        const func = prev[currentFunctionName] || semanticModel?.functions?.[currentFunctionName];
        if (!func) return prev;
        const newAction = createAction('choice', { dialogName: currentFunctionName });
        newAction.targetFunction = newFunctionName;
        const newActions = [...(func.actions || [])];
        newActions.splice(index + 1, 0, newAction);
        return {
          ...prev,
          [currentFunctionName]: { ...func, actions: newActions }
        };
      });
      setTimeout(() => focusAction(index + 1, true), 0);
      return;
    }

    // Use factory for all other action types
    setLocalFunctions((prev) => {
      const func = prev[currentFunctionName] || semanticModel?.functions?.[currentFunctionName];
      if (!func) return prev;
      const newAction = createActionAfterIndex(
        actionType as ActionTypeId,
        index,
        func.actions || [],
        currentFunctionName
      );
      const newActions = [...(func.actions || [])];
      newActions.splice(index + 1, 0, newAction);
      return {
        ...prev,
        [currentFunctionName]: { ...func, actions: newActions }
      };
    });
    setTimeout(() => focusAction(index + 1, true), 0);
  }, [focusAction, semanticModel, currentFunctionName]);

  const addDialogLine = () => {
    if (!currentFunction) return;
    const newAction = createAction('dialogLine', {
      dialogName: currentFunctionName,
      currentAction: undefined
    });
    setLocalFunctions((prev) => ({
      ...prev,
      [currentFunctionName]: {
        ...currentFunction,
        actions: [...(currentFunction.actions || []), newAction]
      }
    }));
  };

  // Build function tree for navigation
  const buildFunctionTree = useCallback((funcName: string, visited: Set<string> = new Set()): any => {
    if (visited.has(funcName)) return null; // Avoid cycles
    visited.add(funcName);

    const func = localFunctions[funcName] || semanticModel?.functions?.[funcName];
    if (!func) return null;

    const choices = (func.actions || []).filter((action: any) =>
      action.dialogRef !== undefined && action.targetFunction !== undefined
    );

    return {
      name: funcName,
      function: func,
      children: choices.map((choice: any) => buildFunctionTree(choice.targetFunction, visited)).filter(Boolean)
    };
  }, [localFunctions, semanticModel]);

  const functionTree = useMemo(() => buildFunctionTree(targetFunctionName), [targetFunctionName, buildFunctionTree]);

  const isDirty = Object.keys(localFunctions).length > 0;

  // Recursive tree node renderer
  const renderTreeNode = (node: any, depth: number = 0): React.ReactNode => {
    if (!node) return null;
    const isExpanded = expandedNodes.has(node.name);
    const isSelected = currentFunctionName === node.name;
    const hasChildren = node.children && node.children.length > 0;
    const choiceCount = hasChildren ? node.children.length : 0;

    return (
      <Box key={node.name}>
        <ListItemButton
          selected={isSelected}
          onClick={() => setCurrentFunctionName(node.name)}
          sx={{ pl: depth * 2 }}
        >
          {hasChildren && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedNodes((prev) => {
                  const newSet = new Set(prev);
                  if (isExpanded) {
                    newSet.delete(node.name);
                  } else {
                    newSet.add(node.name);
                  }
                  return newSet;
                });
              }}
              sx={{ mr: 0.5 }}
            >
              {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          )}
          <ListItemText
            primary={node.name}
            secondary={hasChildren ? `${choiceCount} choice(s)` : undefined}
            primaryTypographyProps={{ fontSize: '0.9rem' }}
            secondaryTypographyProps={{ fontSize: '0.75rem' }}
          />
        </ListItemButton>
        {isExpanded && hasChildren && (
          <Box>
            {node.children.map((child: any) => renderTreeNode(child, depth + 1))}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '80vh' } }}>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">Edit Choice Actions</Typography>
          {isDirty && <Chip label="Unsaved Changes" size="small" color="warning" />}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0, display: 'flex', height: '100%' }}>
        {/* Left Sidebar - Function Tree */}
        <Box sx={{ width: 280, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2" color="text.secondary">Dialog Tree</Typography>
          </Box>
          <List dense sx={{ flex: 1, overflow: 'auto' }}>
            {functionTree && renderTreeNode(functionTree)}
          </List>
        </Box>

        {/* Right Content - Action Editor */}
        <Box sx={{ flex: 1, p: 2, overflow: 'auto' }}>
          {!currentFunction ? (
            <Typography color="text.secondary">
              Function "{currentFunctionName}" not found in semantic model.
            </Typography>
          ) : (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box>
                  <Typography variant="h6">{currentFunctionName}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {(currentFunction.actions || []).length} action(s)
                  </Typography>
                </Box>
                <Button
                  startIcon={<AddIcon />}
                  size="small"
                  variant="outlined"
                  onClick={addDialogLine}
                >
                  Add Line
                </Button>
              </Box>
              <Divider sx={{ mb: 2 }} />
              {(currentFunction.actions || []).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No dialog actions yet. Use the button above to add actions.
                </Typography>
              ) : (
                <Stack spacing={2}>
                  {(currentFunction.actions || []).map((action: any, idx: number) => (
                    <ActionCard
                      key={idx}
                      ref={(el) => (actionRefs.current[idx] = el)}
                      action={action}
                      index={idx}
                      totalActions={(currentFunction.actions || []).length}
                      npcName={npcName}
                      updateAction={updateAction}
                      deleteAction={deleteAction}
                      focusAction={focusAction}
                      addDialogLineAfter={addDialogLineAfter}
                      deleteActionAndFocusPrev={deleteActionAndFocusPrev}
                      addActionAfter={addActionAfter}
                      semanticModel={semanticModel}
                      onNavigateToFunction={(funcName) => {
                        setCurrentFunctionName(funcName);
                        setExpandedNodes((prev) => new Set([...prev, funcName]));
                      }}
                      onRenameFunction={handleRenameFunction}
                      dialogContextName={targetFunctionName}
                    />
                  ))}
                </Stack>
              )}
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={!isDirty}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ChoiceActionEditor;
