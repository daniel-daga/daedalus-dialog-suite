import React, { useState, useRef, useMemo, useCallback } from 'react';
import { Box, Paper, Typography, List, ListItem, ListItemButton, ListItemText, Stack, TextField, Button, IconButton, Chip, Select, MenuItem, FormControl, InputLabel, Tooltip, Menu, Dialog, DialogTitle, DialogContent, DialogActions, Badge, Divider, Drawer } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Save as SaveIcon, Info as InfoIcon, MoreVert as MoreVertIcon, Chat as ChatIcon, CallSplit as CallSplitIcon, Description as DescriptionIcon, LibraryBooks as LibraryBooksIcon, SwapHoriz as SwapHorizIcon, Navigation as NavigationIcon, Code as CodeIcon, HelpOutline as HelpOutlineIcon, Edit as EditIcon, Launch as LaunchIcon, ChevronRight as ChevronRightIcon, ExpandMore as ExpandMoreIcon, Inventory as InventoryIcon, CardGiftcard as CardGiftcardIcon, Gavel as GavelIcon, EmojiPeople as EmojiPeopleIcon } from '@mui/icons-material';
import { useEditorStore } from '../store/editorStore';

interface ThreeColumnLayoutProps {
  filePath: string;
}

/**
 * Generate a unique function name for a choice's target function
 * Format: <DialogName>_Choice_<Number>
 */
const generateUniqueChoiceFunctionName = (dialogName: string, semanticModel: any): string => {
  const baseName = `${dialogName}_Choice`;
  let counter = 1;
  let candidateName = `${baseName}_${counter}`;

  // Keep incrementing until we find a unique name
  while (semanticModel.functions && semanticModel.functions[candidateName]) {
    counter++;
    candidateName = `${baseName}_${counter}`;
  }

  return candidateName;
};

/**
 * Create a new empty function in the semantic model
 */
const createEmptyFunction = (functionName: string): any => {
  return {
    name: functionName,
    returnType: 'void',
    calls: [],
    actions: []
  };
};

/**
 * Validate function name for choice target functions
 * Returns error message if invalid, null if valid
 */
const validateChoiceFunctionName = (
  functionName: string,
  requiredPrefix: string,
  semanticModel: any,
  originalFunctionName?: string
): string | null => {
  if (!functionName || functionName.trim() === '') {
    return 'Function name cannot be empty';
  }

  if (!functionName.startsWith(requiredPrefix)) {
    return `Function name must start with "${requiredPrefix}"`;
  }

  // Check uniqueness (skip if it's the same as original - meaning no rename)
  if (functionName !== originalFunctionName && semanticModel?.functions?.[functionName]) {
    return 'Function name already exists';
  }

  return null;
};

const ThreeColumnLayout: React.FC<ThreeColumnLayoutProps> = ({ filePath }) => {
  const { openFiles, updateModel } = useEditorStore();
  const fileState = openFiles.get(filePath);

  const [selectedNPC, setSelectedNPC] = useState<string | null>(null);
  const [selectedDialog, setSelectedDialog] = useState<string | null>(null);
  const [selectedFunctionName, setSelectedFunctionName] = useState<string | null>(null); // Can be dialog info function or choice function
  const [expandedDialogs, setExpandedDialogs] = useState<Set<string>>(new Set());
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set()); // Track expanded choice nodes

  if (!fileState) {
    return <Typography>Loading...</Typography>;
  }

  const { semanticModel } = fileState;

  // Build function tree for a given function (recursively find choices)
  // ancestorPath tracks the path from root to current node to prevent direct cycles
  const buildFunctionTree = useCallback((funcName: string, ancestorPath: string[] = []): any => {
    // Prevent direct cycles (A -> B -> A), but allow diamonds (A -> B, A -> C, both -> D)
    if (ancestorPath.includes(funcName)) {
      return null; // Direct cycle detected
    }

    const func = semanticModel.functions?.[funcName];
    if (!func) return null;

    const choices = (func.actions || []).filter((action: any) =>
      action.dialogRef !== undefined && action.targetFunction !== undefined
    );

    const newPath = [...ancestorPath, funcName];

    return {
      name: funcName,
      function: func,
      children: choices.map((choice: any) => {
        const subtree = buildFunctionTree(choice.targetFunction, newPath);
        return {
          text: choice.text || '(no text)',
          targetFunction: choice.targetFunction,
          subtree: subtree,
          isShared: choices.filter((c: any) => c.targetFunction === choice.targetFunction).length > 1
        };
      }).filter((c: any) => c.subtree !== null)
    };
  }, [semanticModel]);

  // Extract unique NPCs from all dialogs
  const npcMap = new Map<string, string[]>();
  Object.entries(semanticModel.dialogs || {}).forEach(([dialogName, dialog]: [string, any]) => {
    const npcName = dialog.properties?.npc || 'Unknown NPC';
    if (!npcMap.has(npcName)) {
      npcMap.set(npcName, []);
    }
    npcMap.get(npcName)!.push(dialogName);
  });

  const npcs = Array.from(npcMap.keys()).sort();

  // Get dialogs for selected NPC
  const dialogsForNPC = selectedNPC ? (npcMap.get(selectedNPC) || []) : [];

  // Get selected dialog data
  const dialogData = selectedDialog ? semanticModel.dialogs[selectedDialog] : null;

  // Get the information function for the selected dialog
  const infoFunction = dialogData?.properties?.information as any;
  const dialogInfoFunctionName = typeof infoFunction === 'string' ? infoFunction : infoFunction?.name;

  // Get the currently selected function (either dialog info or choice function)
  const currentFunctionName = selectedFunctionName || dialogInfoFunctionName;
  const currentFunctionData = currentFunctionName ? semanticModel.functions[currentFunctionName] : null;

  return (
    <Box sx={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Column 1: NPC List */}
      <Paper sx={{ width: 250, overflow: 'auto', borderRadius: 0, flexShrink: 0 }} elevation={1}>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6">NPCs</Typography>
          <Typography variant="caption" color="text.secondary">
            {npcs.length} total
          </Typography>
        </Box>
        <List dense>
          {npcs.map((npc) => (
            <ListItem key={npc} disablePadding>
              <ListItemButton
                selected={selectedNPC === npc}
                onClick={() => {
                  setSelectedNPC(npc);
                  setSelectedDialog(null);
                }}
              >
                <ListItemText
                  primary={npc}
                  secondary={`${npcMap.get(npc)?.length || 0} dialog(s)`}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Paper>

      {/* Column 2: Dialog Tree with Nested Choices */}
      <Paper sx={{ width: 350, overflow: 'auto', borderRadius: 0, borderLeft: 1, borderRight: 1, borderColor: 'divider', flexShrink: 0 }} elevation={1}>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6">Dialogs</Typography>
          {selectedNPC && (
            <Typography variant="caption" color="text.secondary">
              {selectedNPC} - {dialogsForNPC.length} dialog(s)
            </Typography>
          )}
        </Box>
        <List dense>
          {selectedNPC ? (
            dialogsForNPC.map((dialogName) => {
              const dialog = semanticModel.dialogs[dialogName];
              const infoFunc = dialog.properties?.information as any;
              const infoFuncName = typeof infoFunc === 'string' ? infoFunc : infoFunc?.name;
              const infoFuncData = infoFuncName ? semanticModel.functions[infoFuncName] : null;
              const actionCount = infoFuncData?.actions?.length || 0;
              const isExpanded = expandedDialogs.has(dialogName);
              const functionTree = infoFuncName ? buildFunctionTree(infoFuncName) : null;
              const hasChoices = functionTree && functionTree.children && functionTree.children.length > 0;

              // Recursive function to render choice subtree
              const renderChoiceTree = (choice: any, depth: number = 1, index: number = 0): React.ReactNode => {
                if (!choice.subtree) return null;
                const isSelected = selectedFunctionName === choice.targetFunction;
                const hasSubchoices = choice.subtree.children && choice.subtree.children.length > 0;
                const choiceKey = `${choice.targetFunction}-${depth}-${index}`;
                const isExpanded = expandedChoices.has(choiceKey);

                return (
                  <Box key={choiceKey}>
                    <ListItemButton
                      selected={isSelected}
                      onClick={() => {
                        setSelectedDialog(dialogName);
                        setSelectedFunctionName(choice.targetFunction);
                      }}
                      sx={{ pl: (depth + 1) * 2, pr: 1 }}
                    >
                      {hasSubchoices ? (
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedChoices((prev) => {
                              const newSet = new Set(prev);
                              if (isExpanded) {
                                newSet.delete(choiceKey);
                              } else {
                                newSet.add(choiceKey);
                              }
                              return newSet;
                            });
                          }}
                          sx={{ width: 28, height: 28, mr: 0.5, flexShrink: 0 }}
                        >
                          {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                        </IconButton>
                      ) : (
                        <Box sx={{ width: 28, height: 28, mr: 0.5, flexShrink: 0 }} />
                      )}
                      <CallSplitIcon fontSize="small" sx={{ mr: 1, fontSize: '1rem', color: 'text.secondary', flexShrink: 0 }} />
                      <ListItemText
                        primary={choice.text}
                        secondary={choice.targetFunction}
                        primaryTypographyProps={{ fontSize: '0.85rem' }}
                        secondaryTypographyProps={{ fontSize: '0.7rem' }}
                      />
                    </ListItemButton>
                    {isExpanded && hasSubchoices && choice.subtree.children.map((subchoice: any, idx: number) =>
                      renderChoiceTree(subchoice, depth + 1, idx)
                    )}
                  </Box>
                );
              };

              return (
                <Box key={dialogName}>
                  <ListItemButton
                    selected={selectedDialog === dialogName && selectedFunctionName === infoFuncName}
                    onClick={() => {
                      setSelectedDialog(dialogName);
                      setSelectedFunctionName(infoFuncName);
                    }}
                    sx={{ pr: 1 }}
                  >
                    {hasChoices ? (
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedDialogs((prev) => {
                            const newSet = new Set(prev);
                            if (isExpanded) {
                              newSet.delete(dialogName);
                            } else {
                              newSet.add(dialogName);
                            }
                            return newSet;
                          });
                        }}
                        sx={{ width: 32, height: 32, mr: 0.5, flexShrink: 0 }}
                      >
                        {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                      </IconButton>
                    ) : (
                      <Box sx={{ width: 32, height: 32, mr: 0.5, flexShrink: 0 }} />
                    )}
                    <ListItemText
                      primary={dialog.properties?.description || dialogName}
                      secondary={dialogName}
                      primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: isExpanded ? 600 : 400 }}
                      secondaryTypographyProps={{ fontSize: '0.75rem' }}
                    />
                  </ListItemButton>
                  {isExpanded && hasChoices && functionTree.children.map((choice: any, idx: number) =>
                    renderChoiceTree(choice, 1, idx)
                  )}
                </Box>
              );
            })
          ) : (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Select an NPC to view dialogs
              </Typography>
            </Box>
          )}
        </List>
      </Paper>

      {/* Column 3: Function Action Editor */}
      <Box sx={{ flex: '1 1 auto', overflow: 'auto', p: 2, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {selectedDialog && dialogData && currentFunctionName && currentFunctionData ? (
          <Box sx={{ width: '100%' }}>
            <DialogDetailsEditor
              key={`${selectedDialog}-${currentFunctionName}`}
              dialogName={selectedDialog}
              dialog={dialogData}
              infoFunction={currentFunctionData}
              filePath={filePath}
              onUpdateDialog={(updatedDialog) => {
                const updatedModel = {
                  ...semanticModel,
                  dialogs: {
                    ...semanticModel.dialogs,
                    [selectedDialog]: updatedDialog
                  }
                };
                updateModel(filePath, updatedModel);
              }}
              onUpdateFunction={(updatedFunction) => {
                if (currentFunctionName) {
                  const updatedModel = {
                    ...semanticModel,
                    functions: {
                      ...semanticModel.functions,
                      [currentFunctionName]: updatedFunction
                    }
                  };
                  updateModel(filePath, updatedModel);
                }
              }}
              onNavigateToFunction={(functionName) => {
                // Navigate to the choice function
                setSelectedFunctionName(functionName);
                // Optionally expand the dialog tree to show the choice
                if (selectedDialog) {
                  setExpandedDialogs((prev) => new Set([...prev, selectedDialog]));
                }
              }}
            />
          </Box>
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

interface DialogDetailsEditorProps {
  dialogName: string;
  dialog: any;
  infoFunction: any;
  filePath: string;
  onUpdateDialog: (dialog: any) => void;
  onUpdateFunction: (func: any) => void;
  onNavigateToFunction?: (functionName: string) => void;
}

const DialogDetailsEditor: React.FC<DialogDetailsEditorProps> = ({
  dialogName,
  dialog,
  infoFunction,
  filePath,
  onUpdateDialog,
  onUpdateFunction,
  onNavigateToFunction
}) => {
  const [localDialog, setLocalDialog] = useState(dialog);
  const [localFunction, setLocalFunction] = useState(infoFunction);
  const { openFiles, saveFile, updateModel } = useEditorStore();
  const fileState = openFiles.get(filePath);
  const actionRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [propertiesExpanded, setPropertiesExpanded] = useState(true);

  const handleUpdateTargetFunction = useCallback((functionName: string, updatedFunc: any) => {
    if (fileState) {
      const updatedModel = {
        ...fileState.semanticModel,
        functions: {
          ...fileState.semanticModel.functions,
          [functionName]: updatedFunc
        }
      };
      updateModel(filePath, updatedModel);
    }
  }, [fileState, filePath, updateModel]);

  const handleRenameFunction = useCallback((oldName: string, newName: string) => {
    if (!fileState) return;

    // Get the function to rename
    const func = fileState.semanticModel.functions[oldName];
    if (!func) return;

    // Create updated functions map
    const updatedFunctions = { ...fileState.semanticModel.functions };
    delete updatedFunctions[oldName];
    updatedFunctions[newName] = { ...func, name: newName };

    // Update semantic model
    const updatedModel = {
      ...fileState.semanticModel,
      functions: updatedFunctions
    };
    updateModel(filePath, updatedModel);

    // Update local function state if we're editing the renamed function
    if (localFunction && infoFunction?.name === oldName) {
      setLocalFunction({ ...localFunction, name: newName });
    }
  }, [fileState, filePath, updateModel, localFunction, infoFunction]);

  // Reset local state when dialog changes
  React.useEffect(() => {
    setLocalDialog(dialog);
    setLocalFunction(infoFunction);
  }, [dialogName, dialog, infoFunction]);

  const focusAction = useCallback((index: number, scrollIntoView = false) => {
    const ref = actionRefs.current[index];
    if (ref) {
      ref.focus();
      // Scroll the element into view smoothly if requested
      if (scrollIntoView) {
        requestAnimationFrame(() => {
          ref.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        });
      }
    }
  }, []);

  const handleSave = () => {
    // Normalize dialog properties to use string references for functions
    const normalizedDialog = {
      ...localDialog,
      properties: {
        ...localDialog.properties,
        information: typeof localDialog.properties?.information === 'object'
          ? localDialog.properties.information.name
          : localDialog.properties?.information,
        condition: typeof localDialog.properties?.condition === 'object'
          ? localDialog.properties.condition.name
          : localDialog.properties?.condition
      }
    };

    onUpdateDialog(normalizedDialog);
    if (localFunction) {
      onUpdateFunction(localFunction);
    }
  };

  const updateAction = useCallback((index: number, updatedAction: any) => {
    setLocalFunction((prev) => {
      if (!prev) return prev;
      const newActions = [...(prev.actions || [])];
      newActions[index] = updatedAction;
      return { ...prev, actions: newActions };
    });
  }, []);

  const deleteAction = useCallback((index: number) => {
    setLocalFunction((prev) => {
      if (!prev) return prev;
      const newActions = (prev.actions || []).filter((_: any, i: number) => i !== index);
      return { ...prev, actions: newActions };
    });
  }, []);

  const deleteActionAndFocusPrev = useCallback((index: number) => {
    setLocalFunction((prev) => {
      if (!prev) return prev;
      const newActions = (prev.actions || []).filter((_: any, i: number) => i !== index);
      return { ...prev, actions: newActions };
    });
    // Focus the previous action after state update
    const prevIdx = index - 1;
    if (prevIdx >= 0) {
      setTimeout(() => focusAction(prevIdx), 0);
    }
  }, [focusAction]);

  const addDialogLineAfter = useCallback((index: number) => {
    setLocalFunction((prev) => {
      if (!prev) return prev;
      const currentAction = (prev.actions || [])[index];
      // Toggle speaker: if current is 'self', new is 'other', and vice versa
      const oppositeSpeaker = currentAction?.speaker === 'self' ? 'other' : 'self';
      const newAction = {
        speaker: oppositeSpeaker,
        text: '',
        id: 'NEW_LINE_ID'
      };
      const newActions = [...(prev.actions || [])];
      newActions.splice(index + 1, 0, newAction);
      return { ...prev, actions: newActions };
    });
    // Focus the new action after state update with smooth scroll
    setTimeout(() => focusAction(index + 1, true), 0);
  }, [focusAction]);

  const addDialogLine = () => {
    if (!localFunction) return;
    const newAction = {
      speaker: 'other',
      text: 'New dialog line',
      id: 'NEW_LINE_ID'
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addChoice = () => {
    if (!localFunction || !fileState) return;

    // Generate unique function name and create the function
    const newFunctionName = generateUniqueChoiceFunctionName(dialogName, fileState.semanticModel);
    const newFunction = createEmptyFunction(newFunctionName);

    // Add the new function to the semantic model
    const updatedModel = {
      ...fileState.semanticModel,
      functions: {
        ...fileState.semanticModel.functions,
        [newFunctionName]: newFunction
      }
    };
    updateModel(filePath, updatedModel);

    // Create the choice action pointing to the new function
    const newAction = {
      dialogRef: dialogName,
      text: '',
      targetFunction: newFunctionName
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addLogEntry = () => {
    if (!localFunction) return;
    const newAction = {
      topic: 'TOPIC_NAME',
      text: 'New log entry'
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addCreateTopic = () => {
    if (!localFunction) return;
    const newAction = {
      topic: 'TOPIC_NAME',
      topicType: 'LOG_MISSION'
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addChapterTransition = () => {
    if (!localFunction) return;
    const newAction = {
      chapter: 1,
      world: 'NEWWORLD_ZEN'
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addExchangeRoutine = () => {
    if (!localFunction) return;
    const newAction = {
      target: 'self',
      routine: 'START'
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addLogSetTopicStatus = () => {
    if (!localFunction) return;
    const newAction = {
      topic: 'TOPIC_NAME',
      status: 'LOG_SUCCESS'
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addCreateInventoryItems = () => {
    if (!localFunction) return;
    const newAction = {
      target: 'hero',
      item: 'ItMi_Gold',
      quantity: 1
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addGiveInventoryItems = () => {
    if (!localFunction) return;
    const newAction = {
      giver: 'self',
      receiver: 'hero',
      item: 'ItMi_Gold',
      quantity: 1
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addAttackAction = () => {
    if (!localFunction) return;
    const newAction = {
      attacker: 'self',
      target: 'hero',
      attackReason: 'ATTACK_REASON_KILL',
      damage: 0
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addSetAttitudeAction = () => {
    if (!localFunction) return;
    const newAction = {
      target: 'self',
      attitude: 'ATT_FRIENDLY'
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addCustomAction = () => {
    if (!localFunction) return;
    const newAction = {
      action: 'AI_StopProcessInfos(self)'
    };
    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  };

  const addActionAfter = useCallback((index: number, actionType: string) => {
    // Handle choice creation specially to generate target function
    if (actionType === 'choice' && fileState) {
      const newFunctionName = generateUniqueChoiceFunctionName(dialogName, fileState.semanticModel);
      const newFunction = createEmptyFunction(newFunctionName);

      // Add the new function to the semantic model
      const updatedModel = {
        ...fileState.semanticModel,
        functions: {
          ...fileState.semanticModel.functions,
          [newFunctionName]: newFunction
        }
      };
      updateModel(filePath, updatedModel);

      // Now add the choice action
      setLocalFunction((prev) => {
        if (!prev) return prev;
        const newAction = {
          dialogRef: dialogName,
          text: '',
          targetFunction: newFunctionName
        };
        const newActions = [...(prev.actions || [])];
        newActions.splice(index + 1, 0, newAction);
        return { ...prev, actions: newActions };
      });
      setTimeout(() => focusAction(index + 1, true), 0);
      return;
    }

    setLocalFunction((prev) => {
      if (!prev) return prev;
      const currentAction = (prev.actions || [])[index];

      let newAction: any;
      switch (actionType) {
        case 'dialogLine':
          const oppositeSpeaker = currentAction?.speaker === 'self' ? 'other' : 'self';
          newAction = {
            speaker: oppositeSpeaker,
            text: '',
            id: 'NEW_LINE_ID'
          };
          break;
        case 'choice':
          // This case should not be reached due to the early return above
          newAction = {
            dialogRef: dialogName,
            text: '',
            targetFunction: ''
          };
          break;
        case 'logEntry':
          newAction = {
            topic: 'TOPIC_NAME',
            text: ''
          };
          break;
        case 'createTopic':
          newAction = {
            topic: 'TOPIC_NAME',
            topicType: 'LOG_MISSION'
          };
          break;
        case 'logSetTopicStatus':
          newAction = {
            topic: 'TOPIC_NAME',
            status: 'LOG_SUCCESS'
          };
          break;
        case 'createInventoryItems':
          newAction = {
            target: 'hero',
            item: 'ItMi_Gold',
            quantity: 1
          };
          break;
        case 'giveInventoryItems':
          newAction = {
            giver: 'self',
            receiver: 'hero',
            item: 'ItMi_Gold',
            quantity: 1
          };
          break;
        case 'attackAction':
          newAction = {
            attacker: 'self',
            target: 'hero',
            attackReason: 'ATTACK_REASON_KILL',
            damage: 0
          };
          break;
        case 'setAttitudeAction':
          newAction = {
            target: 'self',
            attitude: 'ATT_FRIENDLY'
          };
          break;
        case 'chapterTransition':
          newAction = {
            chapter: 1,
            world: 'NEWWORLD_ZEN'
          };
          break;
        case 'exchangeRoutine':
          newAction = {
            target: 'self',
            routine: 'START'
          };
          break;
        case 'customAction':
          newAction = {
            action: 'AI_StopProcessInfos(self)'
          };
          break;
        default:
          return prev;
      }

      const newActions = [...(prev.actions || [])];
      newActions.splice(index + 1, 0, newAction);
      return { ...prev, actions: newActions };
    });
    // Focus the new action after state update with smooth scroll
    setTimeout(() => focusAction(index + 1, true), 0);
  }, [dialogName, focusAction]);

  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  const isDirty = JSON.stringify(dialog) !== JSON.stringify(localDialog) ||
                  JSON.stringify(infoFunction) !== JSON.stringify(localFunction);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h5">{dialogName}</Typography>
          {fileState?.isDirty && <Chip label="File Modified" size="small" color="warning" />}
          {isDirty && <Chip label="Unsaved Changes" size="small" color="error" />}
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            disabled={!isDirty}
            onClick={() => {
              setLocalDialog(dialog);
              setLocalFunction(infoFunction);
            }}
          >
            Reset
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            disabled={!isDirty}
            onClick={handleSave}
          >
            Apply
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<SaveIcon />}
            disabled={!fileState?.isDirty}
            onClick={() => saveFile(filePath)}
          >
            Save File
          </Button>
        </Stack>
      </Box>

      {/* Dialog Properties */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', mb: propertiesExpanded ? 2 : 0 }}
          onClick={() => setPropertiesExpanded(!propertiesExpanded)}
        >
          <Typography variant="h6">Properties</Typography>
          <IconButton size="small">
            {propertiesExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
          </IconButton>
        </Box>
        {propertiesExpanded && (
        <Stack spacing={2}>
          <TextField
            fullWidth
            label="NPC"
            value={localDialog.properties?.npc || ''}
            onChange={(e) => setLocalDialog({
              ...localDialog,
              properties: { ...localDialog.properties, npc: e.target.value }
            })}
            size="small"
          />
          <TextField
            fullWidth
            label="Info Function"
            value={typeof localDialog.properties?.information === 'string' ? localDialog.properties.information : localDialog.properties?.information?.name || ''}
            onChange={(e) => setLocalDialog({
              ...localDialog,
              properties: { ...localDialog.properties, information: e.target.value }
            })}
            size="small"
            helperText="Function that runs when dialog is shown"
            disabled
          />
          <TextField
            fullWidth
            label="Condition Function"
            value={typeof localDialog.properties?.condition === 'string' ? localDialog.properties.condition : localDialog.properties?.condition?.name || ''}
            onChange={(e) => setLocalDialog({
              ...localDialog,
              properties: { ...localDialog.properties, condition: e.target.value }
            })}
            size="small"
            helperText="Function that determines if dialog is available"
          />
          <TextField
            fullWidth
            label="Number (Priority)"
            type="number"
            value={localDialog.properties?.nr || ''}
            onChange={(e) => setLocalDialog({
              ...localDialog,
              properties: { ...localDialog.properties, nr: parseInt(e.target.value) || 0 }
            })}
            size="small"
          />
          <TextField
            fullWidth
            label="Description"
            value={localDialog.properties?.description || ''}
            onChange={(e) => setLocalDialog({
              ...localDialog,
              properties: { ...localDialog.properties, description: e.target.value }
            })}
            size="small"
            multiline
            rows={2}
          />
        </Stack>
        )}
      </Paper>

      {/* Dialog Lines/Choices */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6">{localFunction?.name || 'Dialog Actions'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {(localFunction?.actions || []).length} action(s)
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              startIcon={<AddIcon />}
              size="small"
              variant="outlined"
              onClick={addDialogLine}
            >
              Add Line
            </Button>
            <Button
              startIcon={<AddIcon />}
              size="small"
              variant="outlined"
              onClick={addChoice}
            >
              Add Choice
            </Button>
            <IconButton
              size="small"
              onClick={(e) => setAddMenuAnchor(e.currentTarget)}
              sx={{ ml: 0.5 }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
            <Menu
              anchorEl={addMenuAnchor}
              open={Boolean(addMenuAnchor)}
              onClose={() => setAddMenuAnchor(null)}
            >
              <MenuItem onClick={() => { addLogEntry(); setAddMenuAnchor(null); }}>
                Add Log Entry
              </MenuItem>
              <MenuItem onClick={() => { addCreateTopic(); setAddMenuAnchor(null); }}>
                Add Create Topic
              </MenuItem>
              <MenuItem onClick={() => { addLogSetTopicStatus(); setAddMenuAnchor(null); }}>
                Add Log Set Status
              </MenuItem>
              <MenuItem onClick={() => { addCreateInventoryItems(); setAddMenuAnchor(null); }}>
                Add Create Inventory Items
              </MenuItem>
              <MenuItem onClick={() => { addGiveInventoryItems(); setAddMenuAnchor(null); }}>
                Add Give Inventory Items
              </MenuItem>
              <MenuItem onClick={() => { addAttackAction(); setAddMenuAnchor(null); }}>
                Add Attack Action
              </MenuItem>
              <MenuItem onClick={() => { addSetAttitudeAction(); setAddMenuAnchor(null); }}>
                Add Set Attitude
              </MenuItem>
              <MenuItem onClick={() => { addChapterTransition(); setAddMenuAnchor(null); }}>
                Add Chapter Transition
              </MenuItem>
              <MenuItem onClick={() => { addExchangeRoutine(); setAddMenuAnchor(null); }}>
                Add Exchange Routine
              </MenuItem>
              <MenuItem onClick={() => { addCustomAction(); setAddMenuAnchor(null); }}>
                Add Custom Action
              </MenuItem>
            </Menu>
          </Stack>
        </Box>

        {!localFunction || (localFunction.actions || []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No dialog actions yet. Use the buttons above to add actions.
          </Typography>
        ) : (
          <Stack spacing={2}>
            {(localFunction.actions || []).map((action: any, idx: number) => (
              <ActionCard
                key={idx}
                ref={(el) => (actionRefs.current[idx] = el)}
                action={action}
                index={idx}
                totalActions={(localFunction.actions || []).length}
                npcName={localDialog.properties?.npc || 'NPC'}
                updateAction={updateAction}
                deleteAction={deleteAction}
                focusAction={focusAction}
                addDialogLineAfter={addDialogLineAfter}
                deleteActionAndFocusPrev={deleteActionAndFocusPrev}
                addActionAfter={addActionAfter}
                semanticModel={fileState?.semanticModel}
                onUpdateFunction={handleUpdateTargetFunction}
                onNavigateToFunction={onNavigateToFunction}
                onRenameFunction={handleRenameFunction}
                dialogContextName={dialogName}
              />
            ))}
          </Stack>
        )}
      </Paper>
    </Box>
  );
};


interface ActionCardProps {
  action: any;
  index: number;
  totalActions: number;
  npcName: string;
  updateAction: (index: number, action: any) => void;
  deleteAction: (index: number) => void;
  focusAction: (index: number, scrollIntoView?: boolean) => void;
  addDialogLineAfter: (index: number) => void;
  deleteActionAndFocusPrev: (index: number) => void;
  addActionAfter: (index: number, actionType: string) => void;
  semanticModel?: any;
  onUpdateFunction?: (functionName: string, func: any) => void;
  onNavigateToFunction?: (functionName: string) => void;
  onRenameFunction?: (oldName: string, newName: string) => void;
  dialogContextName?: string; // The dialog/function name for validation prefix
}

const ActionCard = React.memo(React.forwardRef<HTMLInputElement, ActionCardProps>(({ action, index, totalActions, npcName, updateAction, deleteAction, focusAction, addDialogLineAfter, deleteActionAndFocusPrev, addActionAfter, semanticModel, onUpdateFunction, onNavigateToFunction, onRenameFunction, dialogContextName }, ref) => {
  const mainFieldRef = useRef<HTMLInputElement>(null);
  const actionBoxRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedMenuIndex, setSelectedMenuIndex] = useState(0);
  const [hasFocus, setHasFocus] = useState(false);

  // Local state for text input to avoid parent re-renders on every keystroke
  const [localAction, setLocalAction] = useState(action);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync local state when action prop changes from parent
  React.useEffect(() => {
    setLocalAction(action);
  }, [action]);

  // Expose the ref to parent
  React.useImperativeHandle(ref, () => mainFieldRef.current!);

  const flushUpdate = useCallback(() => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    // Sync local state to parent immediately
    updateAction(index, localAction);
  }, [updateAction, index, localAction]);

  const handleUpdate = useCallback((updated: any) => {
    // Update local state immediately for responsive UI
    setLocalAction(updated);
    // Don't update parent during typing - only on flush
  }, []);

  // Cleanup timer on unmount and flush pending updates
  React.useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

  const handleDelete = useCallback(() => {
    deleteAction(index);
  }, [deleteAction, index]);

  const handleTabToNext = useCallback(() => {
    const nextIdx = index + 1;
    if (nextIdx < totalActions) {
      focusAction(nextIdx);
    }
  }, [focusAction, index, totalActions]);

  const handleTabToPrev = useCallback(() => {
    const prevIdx = index - 1;
    if (prevIdx >= 0) {
      focusAction(prevIdx);
    }
  }, [focusAction, index]);

  const handleAddNewAfter = useCallback(() => {
    addDialogLineAfter(index);
  }, [addDialogLineAfter, index]);

  const handleDeleteAndFocusPrev = useCallback(() => {
    deleteActionAndFocusPrev(index);
  }, [deleteActionAndFocusPrev, index]);

  const handleAddActionAfter = useCallback((actionType: string) => {
    addActionAfter(index, actionType);
  }, [addActionAfter, index]);

  // Determine action type
  const isDialogLine = localAction.speaker !== undefined && localAction.text !== undefined && localAction.id !== undefined;
  const isChoice = localAction.dialogRef !== undefined && localAction.targetFunction !== undefined;
  const isCreateTopic = localAction.topic !== undefined && localAction.topicType !== undefined && !localAction.status;
  const isLogEntry = localAction.topic !== undefined && localAction.text !== undefined && !localAction.topicType;
  const isLogSetTopicStatus = localAction.topic !== undefined && localAction.status !== undefined;
  const isCreateInventoryItems = localAction.target !== undefined && localAction.item !== undefined && localAction.quantity !== undefined && localAction.giver === undefined && localAction.receiver === undefined;
  const isGiveInventoryItems = localAction.giver !== undefined && localAction.receiver !== undefined && localAction.item !== undefined && localAction.quantity !== undefined;
  const isAttackAction = localAction.attacker !== undefined && localAction.target !== undefined && localAction.attackReason !== undefined && localAction.damage !== undefined;
  const isSetAttitudeAction = localAction.target !== undefined && localAction.attitude !== undefined && localAction.routine === undefined;
  const isChapterTransition = localAction.chapter !== undefined && localAction.world !== undefined;
  const isExchangeRoutine = (localAction.npc !== undefined || localAction.target !== undefined) && localAction.routine !== undefined && localAction.attitude === undefined;
  const isAction = localAction.action !== undefined;
  const isUnknown = !isDialogLine && !isChoice && !isCreateTopic && !isLogEntry && !isLogSetTopicStatus && !isCreateInventoryItems && !isGiveInventoryItems && !isAttackAction && !isSetAttitudeAction && !isChapterTransition && !isExchangeRoutine && !isAction;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't process any keys if menu is open (menu will handle them)
    if (menuAnchor) {
      return;
    }

    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      flushUpdate();
      handleTabToNext();
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      flushUpdate();
      handleTabToPrev();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      flushUpdate();
      setMenuAnchor(actionBoxRef.current);
      setSelectedMenuIndex(0);
    } else if (e.key === 'Enter' && isDialogLine && localAction.text && localAction.text.trim() !== '') {
      e.preventDefault();
      flushUpdate();
      handleAddNewAfter();
    } else if (e.key === 'Backspace' && isDialogLine && (!localAction.text || localAction.text.trim() === '')) {
      e.preventDefault();
      handleDeleteAndFocusPrev();
    }
  }, [menuAnchor, isDialogLine, localAction.text, flushUpdate, handleTabToNext, handleTabToPrev, handleAddNewAfter, handleDeleteAndFocusPrev]);

  const getActionTypeLabel = () => {
    if (isDialogLine) return 'Dialog Line';
    if (isChoice) return 'Choice';
    if (isCreateTopic) return 'Create Topic';
    if (isLogEntry) return 'Log Entry';
    if (isLogSetTopicStatus) return 'Log Set Status';
    if (isCreateInventoryItems) return 'Create Inventory Items';
    if (isGiveInventoryItems) return 'Give Inventory Items';
    if (isAttackAction) return 'Attack Action';
    if (isSetAttitudeAction) return 'Set Attitude';
    if (isChapterTransition) return 'Chapter Transition';
    if (isExchangeRoutine) return 'Exchange Routine';
    if (isAction) return 'Action';
    return 'Unknown';
  };

  const getActionIcon = () => {
    if (isDialogLine) return <ChatIcon fontSize="small" />;
    if (isChoice) return <CallSplitIcon fontSize="small" />;
    if (isCreateTopic) return <LibraryBooksIcon fontSize="small" />;
    if (isLogEntry) return <DescriptionIcon fontSize="small" />;
    if (isLogSetTopicStatus) return <DescriptionIcon fontSize="small" />;
    if (isCreateInventoryItems) return <InventoryIcon fontSize="small" />;
    if (isGiveInventoryItems) return <CardGiftcardIcon fontSize="small" />;
    if (isAttackAction) return <GavelIcon fontSize="small" />;
    if (isSetAttitudeAction) return <EmojiPeopleIcon fontSize="small" />;
    if (isChapterTransition) return <NavigationIcon fontSize="small" />;
    if (isExchangeRoutine) return <SwapHorizIcon fontSize="small" />;
    if (isAction) return <CodeIcon fontSize="small" />;
    return <HelpOutlineIcon fontSize="small" />;
  };

  const actionTypes = useMemo(() => [
    { type: 'dialogLine', label: 'Dialog Line', icon: <ChatIcon fontSize="small" /> },
    { type: 'choice', label: 'Choice', icon: <CallSplitIcon fontSize="small" /> },
    { type: 'logEntry', label: 'Log Entry', icon: <DescriptionIcon fontSize="small" /> },
    { type: 'createTopic', label: 'Create Topic', icon: <LibraryBooksIcon fontSize="small" /> },
    { type: 'logSetTopicStatus', label: 'Log Set Status', icon: <DescriptionIcon fontSize="small" /> },
    { type: 'createInventoryItems', label: 'Create Inventory Items', icon: <InventoryIcon fontSize="small" /> },
    { type: 'giveInventoryItems', label: 'Give Inventory Items', icon: <CardGiftcardIcon fontSize="small" /> },
    { type: 'attackAction', label: 'Attack Action', icon: <GavelIcon fontSize="small" /> },
    { type: 'setAttitudeAction', label: 'Set Attitude', icon: <EmojiPeopleIcon fontSize="small" /> },
    { type: 'chapterTransition', label: 'Chapter Transition', icon: <NavigationIcon fontSize="small" /> },
    { type: 'exchangeRoutine', label: 'Exchange Routine', icon: <SwapHorizIcon fontSize="small" /> },
    { type: 'customAction', label: 'Custom Action', icon: <CodeIcon fontSize="small" /> },
  ], []);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedMenuIndex((prev) => (prev + 1) % actionTypes.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedMenuIndex((prev) => (prev - 1 + actionTypes.length) % actionTypes.length);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMenuAnchor(null);
      mainFieldRef.current?.focus();
    }
    // Note: Don't handle Enter/Space here - let MenuItem's onClick handle it naturally
    // to avoid double-triggering
  }, [actionTypes, selectedMenuIndex]);

  return (
    <Box
      ref={actionBoxRef}
      sx={{ pb: 2, mb: 2, borderBottom: '1px solid', borderColor: 'divider', position: 'relative' }}
      onFocus={(e) => {
        // Only set focus if the target is an input/select element
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.getAttribute('role') === 'combobox') {
          setHasFocus(true);
        }
      }}
      onBlur={(e) => {
        // Only clear focus state if focus is leaving the entire action box
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setHasFocus(false);
        }
      }}
    >
      <Stack spacing={2}>
          {isDialogLine && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <FormControl size="small" sx={{ width: 150, flexShrink: 0 }}>
                <InputLabel>Speaker</InputLabel>
                <Select
                  value={localAction.speaker || 'self'}
                  label="Speaker"
                  onChange={(e) => handleUpdate({ ...localAction, speaker: e.target.value })}
                  onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
                >
                  <MenuItem value="self">{npcName}</MenuItem>
                  <MenuItem value="other">Hero</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="Text"
                value={localAction.text || ''}
                onChange={(e) => handleUpdate({ ...localAction, text: e.target.value })}
                size="small"
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              {localAction.id && (
                <Tooltip title={`Dialog ID: ${localAction.id}`} arrow>
                  <IconButton size="small" sx={{ flexShrink: 0 }}>
                    <InfoIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isChoice && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Choice Text"
                value={localAction.text || ''}
                onChange={(e) => handleUpdate({ ...localAction, text: e.target.value })}
                size="small"
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
                sx={{ flex: '1 1 40%', minWidth: 150 }}
              />
              <TextField
                label="Function"
                value={localAction.targetFunction || ''}
                onChange={(e) => {
                  const newName = e.target.value;
                  handleUpdate({ ...localAction, targetFunction: newName });
                }}
                onBlur={() => {
                  flushUpdate();
                  // Validate and handle rename if needed
                  if (dialogContextName && onRenameFunction && localAction.targetFunction !== action.targetFunction) {
                    const validationError = validateChoiceFunctionName(
                      localAction.targetFunction,
                      dialogContextName,
                      semanticModel,
                      action.targetFunction
                    );

                    if (validationError) {
                      // Revert to original name on validation error
                      handleUpdate({ ...localAction, targetFunction: action.targetFunction });
                      alert(validationError);
                    } else if (localAction.targetFunction !== action.targetFunction) {
                      // Valid rename - trigger the rename callback
                      onRenameFunction(action.targetFunction, localAction.targetFunction);
                    }
                  }
                }}
                size="small"
                sx={{ flex: '1 1 40%', minWidth: 150 }}
                error={dialogContextName && localAction.targetFunction ? !localAction.targetFunction.startsWith(dialogContextName) : false}
              />
              {semanticModel && localAction.targetFunction && semanticModel.functions && semanticModel.functions[localAction.targetFunction] && onNavigateToFunction && (
                <Tooltip title="Edit choice actions" arrow>
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => {
                      flushUpdate();
                      onNavigateToFunction(localAction.targetFunction);
                    }}
                    sx={{ flexShrink: 0 }}
                  >
                    <Badge
                      badgeContent={semanticModel.functions[localAction.targetFunction]?.actions?.length || 0}
                      color="secondary"
                      sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', height: '16px', minWidth: '16px' } }}
                    >
                      <EditIcon fontSize="small" />
                    </Badge>
                  </IconButton>
                </Tooltip>
              )}
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isCreateTopic && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Topic"
                value={localAction.topic || ''}
                onChange={(e) => handleUpdate({ ...localAction, topic: e.target.value })}
                size="small"
                sx={{ minWidth: 180 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="Topic Type"
                value={localAction.topicType || ''}
                onChange={(e) => handleUpdate({ ...localAction, topicType: e.target.value })}
                size="small"
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isLogEntry && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Topic"
                value={localAction.topic || ''}
                onChange={(e) => handleUpdate({ ...localAction, topic: e.target.value })}
                size="small"
                sx={{ minWidth: 180 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="Text"
                value={localAction.text || ''}
                onChange={(e) => handleUpdate({ ...localAction, text: e.target.value })}
                size="small"
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isLogSetTopicStatus && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Topic"
                value={localAction.topic || ''}
                onChange={(e) => handleUpdate({ ...localAction, topic: e.target.value })}
                size="small"
                sx={{ minWidth: 180 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="Status"
                value={localAction.status || ''}
                onChange={(e) => handleUpdate({ ...localAction, status: e.target.value })}
                size="small"
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isCreateInventoryItems && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Target"
                value={localAction.target || ''}
                onChange={(e) => handleUpdate({ ...localAction, target: e.target.value })}
                size="small"
                sx={{ width: 100 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Item"
                value={localAction.item || ''}
                onChange={(e) => handleUpdate({ ...localAction, item: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Quantity"
                type="number"
                value={localAction.quantity || ''}
                onChange={(e) => handleUpdate({ ...localAction, quantity: parseInt(e.target.value) || 0 })}
                size="small"
                sx={{ width: 90 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isGiveInventoryItems && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Giver"
                value={localAction.giver || ''}
                onChange={(e) => handleUpdate({ ...localAction, giver: e.target.value })}
                size="small"
                sx={{ width: 80 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Receiver"
                value={localAction.receiver || ''}
                onChange={(e) => handleUpdate({ ...localAction, receiver: e.target.value })}
                size="small"
                sx={{ width: 90 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Item"
                value={localAction.item || ''}
                onChange={(e) => handleUpdate({ ...localAction, item: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Quantity"
                type="number"
                value={localAction.quantity || ''}
                onChange={(e) => handleUpdate({ ...localAction, quantity: parseInt(e.target.value) || 0 })}
                size="small"
                sx={{ width: 90 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isAttackAction && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Attacker"
                value={localAction.attacker || ''}
                onChange={(e) => handleUpdate({ ...localAction, attacker: e.target.value })}
                size="small"
                sx={{ width: 90 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Target"
                value={localAction.target || ''}
                onChange={(e) => handleUpdate({ ...localAction, target: e.target.value })}
                size="small"
                sx={{ width: 80 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Reason"
                value={localAction.attackReason || ''}
                onChange={(e) => handleUpdate({ ...localAction, attackReason: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Damage"
                type="number"
                value={localAction.damage || ''}
                onChange={(e) => handleUpdate({ ...localAction, damage: parseInt(e.target.value) || 0 })}
                size="small"
                sx={{ width: 90 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isSetAttitudeAction && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Target"
                value={localAction.target || ''}
                onChange={(e) => handleUpdate({ ...localAction, target: e.target.value })}
                size="small"
                sx={{ width: 120 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="Attitude"
                value={localAction.attitude || ''}
                onChange={(e) => handleUpdate({ ...localAction, attitude: e.target.value })}
                size="small"
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isChapterTransition && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Chapter"
                type="number"
                value={localAction.chapter || ''}
                onChange={(e) => handleUpdate({ ...localAction, chapter: parseInt(e.target.value) || 0 })}
                size="small"
                sx={{ width: 100 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="World"
                value={localAction.world || ''}
                onChange={(e) => handleUpdate({ ...localAction, world: e.target.value })}
                size="small"
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isExchangeRoutine && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Target NPC"
                value={localAction.target || localAction.npc || ''}
                onChange={(e) => {
                  const updated = { ...localAction, routine: localAction.routine };
                  if (localAction.target !== undefined) {
                    updated.target = e.target.value;
                    delete updated.npc;
                  } else {
                    updated.npc = e.target.value;
                    delete updated.target;
                  }
                  handleUpdate(updated);
                }}
                size="small"
                sx={{ width: 120 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="Routine"
                value={localAction.routine || ''}
                onChange={(e) => handleUpdate({ ...localAction, routine: e.target.value })}
                size="small"
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isAction && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0, mt: 0.5 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                fullWidth
                label="Action"
                value={localAction.action || ''}
                onChange={(e) => handleUpdate({ ...localAction, action: e.target.value })}
                size="small"
                multiline
                rows={2}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0, mt: 0.5 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isUnknown && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Tooltip title={getActionTypeLabel()} arrow>
                  <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                    {getActionIcon()}
                  </Box>
                </Tooltip>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" color="warning.main" gutterBottom>
                    This action type is not recognized. Fields detected:
                  </Typography>
                  <TextField
                    fullWidth
                    label="Raw JSON"
                    value={JSON.stringify(localAction, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        handleUpdate(parsed);
                      } catch (err) {
                        // Invalid JSON, ignore
                      }
                    }}
                    size="small"
                    multiline
                    rows={6}
                    helperText="Edit the raw JSON structure"
                    sx={{ fontFamily: 'monospace' }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Properties: {Object.keys(localAction).join(', ')}
                  </Typography>
                </Box>
                <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          )}
      </Stack>

      {/* Action Type Selection Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => {
          setMenuAnchor(null);
          mainFieldRef.current?.focus();
        }}
        onKeyDown={handleMenuKeyDown}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              boxShadow: 2,
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              minWidth: 200
            }
          }
        }}
        MenuListProps={{
          dense: true,
          sx: {
            outline: 'none',
            py: 1
          }
        }}
      >
        {actionTypes.map((actionType, idx) => (
          <MenuItem
            key={actionType.type}
            selected={idx === selectedMenuIndex}
            onClick={() => {
              handleAddActionAfter(actionType.type);
              setMenuAnchor(null);
            }}
            sx={{ gap: 1.5 }}
          >
            <Box sx={{ display: 'flex', color: 'text.secondary' }}>
              {actionType.icon}
            </Box>
            {actionType.label}
          </MenuItem>
        ))}
      </Menu>

      {/* "+" button in divider */}
      <Box
        sx={{
          position: 'absolute',
          bottom: -16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '16px',
            height: '32px',
            px: 1,
            boxShadow: 1,
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              bgcolor: 'action.hover',
              borderColor: 'primary.main',
              boxShadow: 2
            },
            cursor: 'pointer'
          }}
          onClick={(e) => {
            e.stopPropagation();
            setMenuAnchor(e.currentTarget);
            setSelectedMenuIndex(0);
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <AddIcon fontSize="small" sx={{ color: 'primary.main' }} />
          {hasFocus && (
            <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
              Shift+Enter
            </Typography>
          )}
        </Box>
      </Box>

    </Box>
  );
}));

ActionCard.displayName = 'ActionCard';

interface ChoiceActionEditorProps {
  open: boolean;
  onClose: () => void;
  targetFunctionName: string;
  targetFunction: any;
  onUpdateFunction: (func: any) => void;
  npcName: string;
  semanticModel: any;
  onUpdateSemanticFunction: (functionName: string, func: any) => void;
}

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

      // Now add the choice action
      setLocalFunctions((prev) => {
        const func = prev[currentFunctionName] || semanticModel?.functions?.[currentFunctionName];
        if (!func) return prev;
        const newAction = {
          dialogRef: currentFunctionName, // Reference to the current function
          text: '',
          targetFunction: newFunctionName
        };
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

    setLocalFunctions((prev) => {
      const func = prev[currentFunctionName] || semanticModel?.functions?.[currentFunctionName];
      if (!func) return prev;
      const currentAction = (func.actions || [])[index];

      let newAction: any;
      switch (actionType) {
        case 'dialogLine':
          const oppositeSpeaker = currentAction?.speaker === 'self' ? 'other' : 'self';
          newAction = {
            speaker: oppositeSpeaker,
            text: '',
            id: 'NEW_LINE_ID'
          };
          break;
        case 'choice':
          // This case should not be reached due to the early return above
          newAction = {
            dialogRef: currentFunctionName,
            text: '',
            targetFunction: ''
          };
          break;
        case 'logEntry':
          newAction = {
            topic: 'TOPIC_NAME',
            text: ''
          };
          break;
        case 'createTopic':
          newAction = {
            topic: 'TOPIC_NAME',
            topicType: 'LOG_MISSION'
          };
          break;
        case 'logSetTopicStatus':
          newAction = {
            topic: 'TOPIC_NAME',
            status: 'LOG_SUCCESS'
          };
          break;
        case 'createInventoryItems':
          newAction = {
            target: 'hero',
            item: 'ItMi_Gold',
            quantity: 1
          };
          break;
        case 'giveInventoryItems':
          newAction = {
            giver: 'self',
            receiver: 'hero',
            item: 'ItMi_Gold',
            quantity: 1
          };
          break;
        case 'attackAction':
          newAction = {
            attacker: 'self',
            target: 'hero',
            attackReason: 'ATTACK_REASON_KILL',
            damage: 0
          };
          break;
        case 'setAttitudeAction':
          newAction = {
            target: 'self',
            attitude: 'ATT_FRIENDLY'
          };
          break;
        case 'chapterTransition':
          newAction = {
            chapter: 1,
            world: 'NEWWORLD_ZEN'
          };
          break;
        case 'exchangeRoutine':
          newAction = {
            target: 'self',
            routine: 'START'
          };
          break;
        case 'customAction':
          newAction = {
            action: 'AI_StopProcessInfos(self)'
          };
          break;
        default:
          return prev;
      }

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
    const newAction = {
      speaker: 'other',
      text: 'New dialog line',
      id: 'NEW_LINE_ID'
    };
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
                      onUpdateFunction={(funcName, func) => {
                        setLocalFunctions((prev) => ({
                          ...prev,
                          [funcName]: func
                        }));
                      }}
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

export default ThreeColumnLayout;