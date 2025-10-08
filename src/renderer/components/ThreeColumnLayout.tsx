import React, { useState, useRef, useMemo, useCallback } from 'react';
import { Box, Paper, Typography, List, ListItem, ListItemButton, ListItemText, Stack, TextField, Button, IconButton, Chip, Select, MenuItem, FormControl, InputLabel, Tooltip, Menu, Dialog, DialogTitle, DialogContent, DialogActions, Badge } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Save as SaveIcon, Info as InfoIcon, MoreVert as MoreVertIcon, Chat as ChatIcon, CallSplit as CallSplitIcon, Description as DescriptionIcon, LibraryBooks as LibraryBooksIcon, SwapHoriz as SwapHorizIcon, Navigation as NavigationIcon, Code as CodeIcon, HelpOutline as HelpOutlineIcon, Edit as EditIcon, Launch as LaunchIcon } from '@mui/icons-material';
import { useEditorStore } from '../store/editorStore';

interface ThreeColumnLayoutProps {
  filePath: string;
}

const ThreeColumnLayout: React.FC<ThreeColumnLayoutProps> = ({ filePath }) => {
  const { openFiles, updateModel } = useEditorStore();
  const fileState = openFiles.get(filePath);

  const [selectedNPC, setSelectedNPC] = useState<string | null>(null);
  const [selectedDialog, setSelectedDialog] = useState<string | null>(null);

  if (!fileState) {
    return <Typography>Loading...</Typography>;
  }

  const { semanticModel } = fileState;

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
  const infoFunctionName = typeof infoFunction === 'string' ? infoFunction : infoFunction?.name;
  const infoFunctionData = infoFunctionName ? semanticModel.functions[infoFunctionName] : null;

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

      {/* Column 2: Dialog Instances */}
      <Paper sx={{ width: 300, overflow: 'auto', borderRadius: 0, borderLeft: 1, borderRight: 1, borderColor: 'divider', flexShrink: 0 }} elevation={1}>
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

              return (
                <ListItem key={dialogName} disablePadding>
                  <ListItemButton
                    selected={selectedDialog === dialogName}
                    onClick={() => setSelectedDialog(dialogName)}
                  >
                    <ListItemText
                      primary={dialogName}
                      secondary={
                        <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          {dialog.properties?.description && (
                            <Typography variant="caption" component="span" sx={{ color: 'text.secondary' }}>
                              {dialog.properties.description}
                            </Typography>
                          )}
                          {dialog.properties?.information && (
                            <Typography variant="caption" component="span" sx={{ color: 'info.main' }}>
                              Info: {typeof dialog.properties.information === 'string' ? dialog.properties.information : dialog.properties.information?.name || 'N/A'}
                            </Typography>
                          )}
                          {dialog.properties?.condition && (
                            <Typography variant="caption" component="span" sx={{ color: 'warning.main' }}>
                              Condition: {typeof dialog.properties.condition === 'string' ? dialog.properties.condition : dialog.properties.condition?.name || 'N/A'}
                            </Typography>
                          )}
                          {actionCount > 0 && (
                            <Typography variant="caption" component="span" sx={{ color: 'primary.main' }}>
                              {actionCount} action(s)
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  </ListItemButton>
                </ListItem>
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

      {/* Column 3: Dialog Editor */}
      <Box sx={{ flex: '1 1 auto', overflow: 'auto', p: 2, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {selectedDialog && dialogData ? (
          <Box sx={{ width: '100%' }}>
            <DialogDetailsEditor
              key={selectedDialog}
              dialogName={selectedDialog}
              dialog={dialogData}
              infoFunction={infoFunctionData}
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
                if (infoFunctionName) {
                  const updatedModel = {
                    ...semanticModel,
                    functions: {
                      ...semanticModel.functions,
                      [infoFunctionName]: updatedFunction
                    }
                  };
                  updateModel(filePath, updatedModel);
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
}

const DialogDetailsEditor: React.FC<DialogDetailsEditorProps> = ({
  dialogName,
  dialog,
  infoFunction,
  filePath,
  onUpdateDialog,
  onUpdateFunction
}) => {
  const [localDialog, setLocalDialog] = useState(dialog);
  const [localFunction, setLocalFunction] = useState(infoFunction);
  const { openFiles, saveFile, updateModel } = useEditorStore();
  const fileState = openFiles.get(filePath);
  const actionRefs = useRef<(HTMLInputElement | null)[]>([]);

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
    if (!localFunction) return;
    const newAction = {
      dialogRef: dialogName,
      text: 'New choice',
      targetFunction: ''
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
        <Typography variant="h6" gutterBottom>Properties</Typography>
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
      </Paper>

      {/* Dialog Lines/Choices */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Dialog Actions</Typography>
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
}

const ActionCard = React.memo(React.forwardRef<HTMLInputElement, ActionCardProps>(({ action, index, totalActions, npcName, updateAction, deleteAction, focusAction, addDialogLineAfter, deleteActionAndFocusPrev, addActionAfter, semanticModel, onUpdateFunction }, ref) => {
  const mainFieldRef = useRef<HTMLInputElement>(null);
  const actionBoxRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedMenuIndex, setSelectedMenuIndex] = useState(0);
  const [hasFocus, setHasFocus] = useState(false);
  const [choiceEditorOpen, setChoiceEditorOpen] = useState(false);

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
  const isCreateTopic = localAction.topic !== undefined && localAction.topicType !== undefined;
  const isLogEntry = localAction.topic !== undefined && localAction.text !== undefined && !localAction.topicType;
  const isChapterTransition = localAction.chapter !== undefined && localAction.world !== undefined;
  const isExchangeRoutine = (localAction.npc !== undefined || localAction.target !== undefined) && localAction.routine !== undefined;
  const isAction = localAction.action !== undefined;
  const isUnknown = !isDialogLine && !isChoice && !isCreateTopic && !isLogEntry && !isChapterTransition && !isExchangeRoutine && !isAction;

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
                fullWidth
                label="Choice Text"
                value={localAction.text || ''}
                onChange={(e) => handleUpdate({ ...localAction, text: e.target.value })}
                size="small"
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              {localAction.targetFunction && (
                <Tooltip title={`Target Function: ${localAction.targetFunction}`} arrow>
                  <IconButton size="small" sx={{ flexShrink: 0 }}>
                    <InfoIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {semanticModel && localAction.targetFunction && semanticModel.functions && semanticModel.functions[localAction.targetFunction] && (
                <Tooltip title="Edit choice actions" arrow>
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => setChoiceEditorOpen(true)}
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

      {/* Choice Action Editor Modal */}
      {isChoice && semanticModel && localAction.targetFunction && onUpdateFunction && (
        <ChoiceActionEditor
          open={choiceEditorOpen}
          onClose={() => setChoiceEditorOpen(false)}
          targetFunctionName={localAction.targetFunction}
          targetFunction={semanticModel.functions?.[localAction.targetFunction]}
          onUpdateFunction={(updatedFunc) => {
            onUpdateFunction(localAction.targetFunction, updatedFunc);
            setChoiceEditorOpen(false);
          }}
          npcName={npcName}
          semanticModel={semanticModel}
          onUpdateSemanticFunction={onUpdateFunction}
        />
      )}
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
  const [localFunction, setLocalFunction] = useState(targetFunction);
  const actionRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Reset local state when targetFunction changes
  React.useEffect(() => {
    setLocalFunction(targetFunction);
  }, [targetFunction]);

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
    onUpdateFunction(localFunction);
    onClose();
  };

  const updateAction = useCallback((index: number, updatedAction: any) => {
    setLocalFunction((prev: any) => {
      if (!prev) return prev;
      const newActions = [...(prev.actions || [])];
      newActions[index] = updatedAction;
      return { ...prev, actions: newActions };
    });
  }, []);

  const deleteAction = useCallback((index: number) => {
    setLocalFunction((prev: any) => {
      if (!prev) return prev;
      const newActions = (prev.actions || []).filter((_: any, i: number) => i !== index);
      return { ...prev, actions: newActions };
    });
  }, []);

  const deleteActionAndFocusPrev = useCallback((index: number) => {
    setLocalFunction((prev: any) => {
      if (!prev) return prev;
      const newActions = (prev.actions || []).filter((_: any, i: number) => i !== index);
      return { ...prev, actions: newActions };
    });
    const prevIdx = index - 1;
    if (prevIdx >= 0) {
      setTimeout(() => focusAction(prevIdx), 0);
    }
  }, [focusAction]);

  const addDialogLineAfter = useCallback((index: number) => {
    setLocalFunction((prev: any) => {
      if (!prev) return prev;
      const currentAction = (prev.actions || [])[index];
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
    setTimeout(() => focusAction(index + 1, true), 0);
  }, [focusAction]);

  const addActionAfter = useCallback((index: number, actionType: string) => {
    setLocalFunction((prev: any) => {
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
          newAction = {
            dialogRef: 'DIALOG_REF',
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

  const isDirty = JSON.stringify(targetFunction) !== JSON.stringify(localFunction);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">Edit Choice Actions: {targetFunctionName}</Typography>
          {isDirty && <Chip label="Unsaved Changes" size="small" color="warning" />}
        </Box>
      </DialogTitle>
      <DialogContent>
        {!localFunction ? (
          <Typography color="text.secondary">
            Function "{targetFunctionName}" not found in semantic model.
          </Typography>
        ) : (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle1">
                Dialog Actions ({(localFunction.actions || []).length})
              </Typography>
              <Button
                startIcon={<AddIcon />}
                size="small"
                variant="outlined"
                onClick={addDialogLine}
              >
                Add Line
              </Button>
            </Box>
            {(localFunction.actions || []).length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No dialog actions yet. Use the button above to add actions.
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
                    npcName={npcName}
                    updateAction={updateAction}
                    deleteAction={deleteAction}
                    focusAction={focusAction}
                    addDialogLineAfter={addDialogLineAfter}
                    deleteActionAndFocusPrev={deleteActionAndFocusPrev}
                    addActionAfter={addActionAfter}
                    semanticModel={semanticModel}
                    onUpdateFunction={onUpdateSemanticFunction}
                  />
                ))}
              </Stack>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { setLocalFunction(targetFunction); onClose(); }}>
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