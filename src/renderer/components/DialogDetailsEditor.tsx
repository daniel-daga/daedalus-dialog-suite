import React, { useState, useRef, useCallback } from 'react';
import { Box, Paper, Typography, Stack, TextField, Button, IconButton, Chip, Menu, MenuItem } from '@mui/material';
import { Add as AddIcon, Save as SaveIcon, MoreVert as MoreVertIcon, ExpandMore as ExpandMoreIcon, ChevronRight as ChevronRightIcon } from '@mui/icons-material';
import { useEditorStore } from '../store/editorStore';
import { DialogDetailsEditorProps } from './dialogTypes';
import ActionCard from './ActionCard';
import { generateUniqueChoiceFunctionName, createEmptyFunction } from './dialogUtils';

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
  }, [dialogName, focusAction, fileState, filePath, updateModel]);

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

export default DialogDetailsEditor;
