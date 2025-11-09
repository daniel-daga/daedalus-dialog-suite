import React, { useState, useCallback } from 'react';
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
  filePath,
  functionName,
  onNavigateToFunction
}) => {
  const { openFiles, saveFile, updateDialog, updateFunction } = useEditorStore();
  const fileState = openFiles.get(filePath);
  const [propertiesExpanded, setPropertiesExpanded] = useState(false);

  // Read directly from store
  const dialog = fileState?.semanticModel?.dialogs?.[dialogName];
  const infoFunctionName = typeof dialog?.properties?.information === 'string'
    ? dialog.properties.information
    : dialog?.properties?.information?.name;
  const currentFunctionName = functionName || infoFunctionName;
  const currentFunction = currentFunctionName ? fileState?.semanticModel?.functions?.[currentFunctionName] : null;

  // Use custom hooks for focus navigation and action management
  const { actionRefs, focusAction, trimRefs } = useFocusNavigation();

  // Callback that updates function in store (for useActionManagement)
  const setFunction = useCallback((updatedFunction: any) => {
    if (currentFunctionName) {
      updateFunction(filePath, currentFunctionName, updatedFunction);
    }
  }, [currentFunctionName, filePath, updateFunction]);

  const {
    updateAction,
    deleteAction,
    deleteActionAndFocusPrev,
    addDialogLineAfter,
    addActionAfter
  } = useActionManagement({
    setFunction,
    focusAction,
    semanticModel: fileState?.semanticModel,
    onUpdateSemanticModel: (funcName: string, func: any) => {
      updateFunction(filePath, funcName, func);
    },
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
    // Use updateModel for this complex operation
    useEditorStore.getState().updateModel(filePath, updatedModel);
  }, [fileState, filePath]);

  // Trim refs array to match current actions length
  React.useEffect(() => {
    const actionsLength = currentFunction?.actions?.length || 0;
    trimRefs(actionsLength);
  }, [currentFunction?.actions?.length, trimRefs]);

  const handleSave = async () => {
    // Just save to disk - all changes are already in the store!
    await saveFile(filePath);
  };

  // Unified function to add any type of action at the end
  const addActionToEnd = useCallback((actionType: ActionTypeId) => {
    if (!currentFunction) return;

    let newAction: any;

    // Handle choice specially to create target function
    if (actionType === 'choice' && fileState) {
      const newFunctionName = generateUniqueChoiceFunctionName(dialogName, fileState.semanticModel);
      const newFunction = createEmptyFunction(newFunctionName);

      // Add the new function to the semantic model
      updateFunction(filePath, newFunctionName, newFunction);

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

    // Update function with new action
    const updatedFunction = {
      ...currentFunction,
      actions: [...(currentFunction.actions || []), newAction]
    };
    setFunction(updatedFunction);
  }, [currentFunction, fileState, dialogName, filePath, updateFunction, setFunction]);

  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  // isDirty comes directly from store
  const isDirty = fileState?.isDirty || false;

  const handleDialogPropertyChange = useCallback((updatedDialog: any) => {
    // Normalize dialog properties to use string references for functions
    const normalizedDialog = {
      ...updatedDialog,
      properties: {
        ...updatedDialog.properties,
        information: typeof updatedDialog.properties?.information === 'object'
          ? updatedDialog.properties.information.name
          : updatedDialog.properties?.information,
        condition: typeof updatedDialog.properties?.condition === 'object'
          ? updatedDialog.properties.condition.name
          : updatedDialog.properties?.condition
      }
    };
    updateDialog(filePath, dialogName, normalizedDialog);
  }, [filePath, dialogName, updateDialog]);

  const handleReset = async () => {
    // Reload file from disk
    await useEditorStore.getState().openFile(filePath);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h5">{dialogName}</Typography>
          {isDirty && <Chip label="Unsaved Changes" size="small" color="error" />}
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            disabled={!isDirty}
            onClick={handleReset}
          >
            Reset
          </Button>
          <Button
            variant="contained"
            color="success"
            startIcon={<SaveIcon />}
            disabled={!isDirty}
            onClick={handleSave}
          >
            Save
          </Button>
        </Stack>
      </Box>

      {/* Dialog Properties */}
      {dialog && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', mb: propertiesExpanded ? 2 : 0 }}
            onClick={() => setPropertiesExpanded(!propertiesExpanded)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="h6">Properties</Typography>
              {!propertiesExpanded && (
                <>
                  {dialog.properties?.npc && (
                    <Chip
                      label={`NPC: ${dialog.properties.npc}`}
                      size="small"
                      color="primary"
                      variant="outlined"
                      sx={{ fontSize: '0.75rem' }}
                    />
                  )}
                  {dialog.properties?.description && (
                    <Chip
                      label={dialog.properties.description}
                      size="small"
                      color="default"
                      sx={{ fontSize: '0.75rem', maxWidth: '400px' }}
                    />
                  )}
                </>
              )}
            </Box>
            <IconButton size="small">
              {propertiesExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
            </IconButton>
          </Box>
          {propertiesExpanded && (
            <Stack spacing={2}>
              <TextField
                fullWidth
                label="NPC"
                value={dialog.properties?.npc || ''}
                onChange={(e) => handleDialogPropertyChange({
                  ...dialog,
                  properties: { ...dialog.properties, npc: e.target.value }
                })}
                size="small"
              />
              <TextField
                fullWidth
                label="Number (Priority)"
                type="number"
                value={dialog.properties?.nr || ''}
                onChange={(e) => handleDialogPropertyChange({
                  ...dialog,
                  properties: { ...dialog.properties, nr: parseInt(e.target.value) || 0 }
                })}
                size="small"
              />
              <TextField
                fullWidth
                label="Description"
                value={dialog.properties?.description || ''}
                onChange={(e) => handleDialogPropertyChange({
                  ...dialog,
                  properties: { ...dialog.properties, description: e.target.value }
                })}
                size="small"
                multiline
                rows={2}
              />
            </Stack>
          )}
        </Paper>
      )}

      {/* Condition Editor */}
      {dialog?.properties?.condition && fileState?.semanticModel?.functions?.[
        typeof dialog.properties.condition === 'string'
          ? dialog.properties.condition
          : dialog.properties.condition.name
      ] && (
        <ConditionEditor
          conditionFunction={
            fileState.semanticModel.functions[
              typeof dialog.properties.condition === 'string'
                ? dialog.properties.condition
                : dialog.properties.condition.name
            ]
          }
          onUpdateFunction={(func: any) => {
            updateFunction(filePath, func.name, func);
          }}
          semanticModel={fileState.semanticModel}
          filePath={filePath}
          dialogName={dialogName}
        />
      )}

      {/* Dialog Lines/Choices */}
      {currentFunction && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="h6">{currentFunction.name || 'Dialog Actions'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {(currentFunction.actions || []).length} action(s)
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

          {(currentFunction.actions || []).length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No dialog actions yet. Use the buttons above to add actions.
            </Typography>
          ) : (
            <ActionsList
              actions={currentFunction.actions || []}
              actionRefs={actionRefs}
              npcName={dialog?.properties?.npc || 'NPC'}
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
      )}
    </Box>
  );
};

export default DialogDetailsEditor;
