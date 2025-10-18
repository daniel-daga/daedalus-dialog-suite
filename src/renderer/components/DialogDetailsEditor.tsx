import React, { useState, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { Box, Paper, Typography, Stack, TextField, Button, IconButton, Chip, Menu, MenuItem } from '@mui/material';
import { Add as AddIcon, Save as SaveIcon, MoreVert as MoreVertIcon, ExpandMore as ExpandMoreIcon, ChevronRight as ChevronRightIcon } from '@mui/icons-material';
import { useEditorStore } from '../store/editorStore';
import { DialogDetailsEditorProps } from './dialogTypes';
import ActionsList from './ActionsList';
import ConditionEditor from './ConditionEditor';
import { generateUniqueChoiceFunctionName, createEmptyFunction } from './dialogUtils';
import { createAction } from './actionFactory';
import type { ActionTypeId } from './actionTypes';
import { useFocusNavigation } from './hooks/useFocusNavigation';
import { useActionManagement } from './hooks/useActionManagement';

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
  const [propertiesExpanded, setPropertiesExpanded] = useState(true);

  // Use custom hooks for focus navigation and action management
  const { actionRefs, focusAction, trimRefs } = useFocusNavigation();

  const handleUpdateSemanticModel = useCallback((functionName: string, func: any) => {
    if (fileState) {
      const updatedModel = {
        ...fileState.semanticModel,
        functions: {
          ...fileState.semanticModel.functions,
          [functionName]: func
        }
      };
      updateModel(filePath, updatedModel);
    }
  }, [fileState, filePath, updateModel]);

  const {
    updateAction,
    deleteAction,
    deleteActionAndFocusPrev,
    addDialogLineAfter,
    addActionAfter
  } = useActionManagement({
    setFunction: setLocalFunction,
    focusAction,
    semanticModel: fileState?.semanticModel,
    onUpdateSemanticModel: handleUpdateSemanticModel,
    contextName: dialogName
  });

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
    // Update the refs when props change
    initialDialogRef.current = dialog;
    initialFunctionRef.current = infoFunction;
  }, [dialogName, dialog, infoFunction]);

  // Trim refs array to match current actions length
  React.useEffect(() => {
    const actionsLength = localFunction?.actions?.length || 0;
    trimRefs(actionsLength);
  }, [localFunction?.actions?.length, trimRefs]);

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

  // Unified function to add any type of action at the end
  const addActionToEnd = useCallback((actionType: ActionTypeId) => {
    if (!localFunction) return;

    let newAction: any;

    // Handle choice specially to create target function
    if (actionType === 'choice' && fileState) {
      const newFunctionName = generateUniqueChoiceFunctionName(dialogName, fileState.semanticModel);
      const newFunction = createEmptyFunction(newFunctionName);

      // Add the new function to the semantic model
      handleUpdateSemanticModel(newFunctionName, newFunction);

      // Create choice with target function
      newAction = createAction('choice', {
        dialogName,
        currentAction: undefined
      });
      newAction.targetFunction = newFunctionName;
    } else {
      // Use factory for all other action types
      newAction = createAction(actionType, {
        dialogName,
        currentAction: undefined
      });
    }

    setLocalFunction({
      ...localFunction,
      actions: [...(localFunction.actions || []), newAction]
    });
  }, [localFunction, fileState, dialogName, handleUpdateSemanticModel]);

  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  // Optimize dirty check - use shallow comparison instead of JSON.stringify for better performance
  // Cache the initial values to avoid re-stringifying on every render
  const initialDialogRef = useRef(dialog);
  const initialFunctionRef = useRef(infoFunction);

  const isDirty = useMemo(() => {
    return JSON.stringify(initialDialogRef.current) !== JSON.stringify(localDialog) ||
           JSON.stringify(initialFunctionRef.current) !== JSON.stringify(localFunction);
  }, [localDialog, localFunction]);

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

      {/* Condition Editor */}
      {localDialog.properties?.condition && fileState?.semanticModel?.functions?.[
        typeof localDialog.properties.condition === 'string'
          ? localDialog.properties.condition
          : localDialog.properties.condition.name
      ] && (
        <ConditionEditor
          conditionFunction={
            fileState.semanticModel.functions[
              typeof localDialog.properties.condition === 'string'
                ? localDialog.properties.condition
                : localDialog.properties.condition.name
            ]
          }
          onUpdateFunction={(func: any) => {
            handleUpdateSemanticModel(func.name, func);
          }}
          semanticModel={fileState.semanticModel}
          filePath={filePath}
          dialogName={dialogName}
        />
      )}

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
              onClick={() => addActionToEnd('dialogLine')}
            >
              Add Line
            </Button>
            <Button
              startIcon={<AddIcon />}
              size="small"
              variant="outlined"
              onClick={() => addActionToEnd('choice')}
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
              <MenuItem onClick={() => { addActionToEnd('logEntry'); setAddMenuAnchor(null); }}>
                Add Log Entry
              </MenuItem>
              <MenuItem onClick={() => { addActionToEnd('createTopic'); setAddMenuAnchor(null); }}>
                Add Create Topic
              </MenuItem>
              <MenuItem onClick={() => { addActionToEnd('logSetTopicStatus'); setAddMenuAnchor(null); }}>
                Add Log Set Status
              </MenuItem>
              <MenuItem onClick={() => { addActionToEnd('createInventoryItems'); setAddMenuAnchor(null); }}>
                Add Create Inventory Items
              </MenuItem>
              <MenuItem onClick={() => { addActionToEnd('giveInventoryItems'); setAddMenuAnchor(null); }}>
                Add Give Inventory Items
              </MenuItem>
              <MenuItem onClick={() => { addActionToEnd('attackAction'); setAddMenuAnchor(null); }}>
                Add Attack Action
              </MenuItem>
              <MenuItem onClick={() => { addActionToEnd('setAttitudeAction'); setAddMenuAnchor(null); }}>
                Add Set Attitude
              </MenuItem>
              <MenuItem onClick={() => { addActionToEnd('chapterTransition'); setAddMenuAnchor(null); }}>
                Add Chapter Transition
              </MenuItem>
              <MenuItem onClick={() => { addActionToEnd('exchangeRoutine'); setAddMenuAnchor(null); }}>
                Add Exchange Routine
              </MenuItem>
              <MenuItem onClick={() => { addActionToEnd('customAction'); setAddMenuAnchor(null); }}>
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
          <ActionsList
            actions={localFunction.actions || []}
            actionRefs={actionRefs}
            npcName={localDialog.properties?.npc || 'NPC'}
            updateAction={updateAction}
            deleteAction={deleteAction}
            focusAction={focusAction}
            addDialogLineAfter={addDialogLineAfter}
            deleteActionAndFocusPrev={deleteActionAndFocusPrev}
            addActionAfter={addActionAfter}
            semanticModel={fileState?.semanticModel}
            onNavigateToFunction={onNavigateToFunction}
            onRenameFunction={handleRenameFunction}
            dialogContextName={dialogName}
          />
        )}
      </Paper>
    </Box>
  );
};

export default DialogDetailsEditor;
