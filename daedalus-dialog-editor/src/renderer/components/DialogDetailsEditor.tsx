import React, { useEffect } from 'react';
import {
  Box,
  Typography,
  Stack,
  Button,
  Snackbar,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Code as CodeIcon
} from '@mui/icons-material';
import { useEditorStore } from '../store/editorStore';
import { DialogDetailsEditorProps } from './dialogTypes';
import ValidationErrorDialog from './ValidationErrorDialog';
import DialogSourceViewDialog from './DialogSourceViewDialog';
import DialogPropertiesSection from './DialogPropertiesSection';
import ConditionSection from './ConditionSection';
import DialogActionsSection from './DialogActionsSection';
import { useFocusNavigation } from './hooks/useFocusNavigation';
import { useActionManagement } from './hooks/useActionManagement';
import { useDialogEditorUIState } from './hooks/useDialogEditorUIState';
import { useDialogEditorCommands } from './hooks/useDialogEditorCommands';

const DialogDetailsEditor: React.FC<DialogDetailsEditorProps> = ({
  dialogName,
  filePath,
  functionName,
  onNavigateToFunction,
  semanticModel: passedSemanticModel
}) => {
  const { openFiles, saveFile, updateFunction } = useEditorStore();
  const fileState = filePath ? openFiles.get(filePath) : null;
  const semanticModel = fileState?.semanticModel || passedSemanticModel;

  const dialog = semanticModel?.dialogs?.[dialogName];
  const informationFunctionName = typeof dialog?.properties?.information === 'string'
    ? dialog.properties.information
    : dialog?.properties?.information?.name;
  const currentFunctionName = functionName || informationFunctionName || null;
  const currentFunction = currentFunctionName
    ? semanticModel?.functions?.[currentFunctionName] || null
    : null;

  const uiState = useDialogEditorUIState();
  const { actionRefs, focusAction, trimRefs } = useFocusNavigation();

  const {
    setFunction,
    handleRenameFunction,
    addActionToEnd,
    handleDialogPropertyChange,
    handleConditionFunctionUpdate,
    handleSaveAnyway,
    handleCancelValidation,
    handleReset
  } = useDialogEditorCommands({
    dialogName,
    filePath,
    currentFunctionName,
    currentFunction,
    semanticModel,
    saveFile,
    updateFunction,
    focusAction,
    setIsSaving: uiState.setIsSaving,
    setIsResetting: uiState.setIsResetting,
    setSnackbar: uiState.setSnackbar,
    setValidationDialog: uiState.setValidationDialog
  });

  const {
    updateAction,
    deleteAction,
    deleteActionAndFocusPrev,
    addDialogLineAfter,
    addActionAfter
  } = useActionManagement({
    setFunction,
    focusAction,
    semanticModel,
    onUpdateSemanticModel: (functionNameToUpdate, updatedFunction) => {
      if (filePath) {
        updateFunction(filePath, functionNameToUpdate, updatedFunction);
      }
    },
    contextName: dialogName
  });

  useEffect(() => {
    trimRefs(currentFunction?.actions?.length || 0);
  }, [currentFunction?.actions?.length, trimRefs]);

  const isDirty = fileState?.isDirty || false;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h5">{dialogName}</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={() => uiState.setSourceViewOpen(true)}
            startIcon={<CodeIcon />}
          >
            View Source
          </Button>
          <Button
            variant="outlined"
            disabled={!isDirty || uiState.isResetting || uiState.isSaving}
            onClick={handleReset}
            startIcon={uiState.isResetting ? <CircularProgress size={16} /> : undefined}
          >
            {uiState.isResetting ? 'Resetting...' : 'Reset'}
          </Button>
        </Stack>
      </Box>

      {dialog && (
        <DialogPropertiesSection
          dialog={dialog}
          semanticModel={semanticModel}
          propertiesExpanded={uiState.propertiesExpanded}
          onToggleExpanded={() => uiState.setPropertiesExpanded(!uiState.propertiesExpanded)}
          onDialogPropertyChange={handleDialogPropertyChange}
        />
      )}

      {dialog && (
        <ConditionSection
          dialogName={dialogName}
          dialog={dialog}
          semanticModel={semanticModel}
          filePath={filePath}
          onUpdateFunction={handleConditionFunctionUpdate}
        />
      )}

      {currentFunction && (
        <DialogActionsSection
          dialogName={dialogName}
          currentFunction={currentFunction}
          npcName={dialog?.properties?.npc || 'NPC'}
          actionRefs={actionRefs}
          updateAction={updateAction}
          deleteAction={deleteAction}
          deleteActionAndFocusPrev={deleteActionAndFocusPrev}
          addDialogLineAfter={addDialogLineAfter}
          addActionAfter={addActionAfter}
          focusAction={focusAction}
          semanticModel={semanticModel}
          onNavigateToFunction={onNavigateToFunction}
          onRenameFunction={handleRenameFunction}
          onAddActionToEnd={addActionToEnd}
        />
      )}

      <ValidationErrorDialog
        open={uiState.validationDialog.open}
        validationResult={uiState.validationDialog.validationResult}
        onClose={handleCancelValidation}
        onSaveAnyway={handleSaveAnyway}
        onCancel={handleCancelValidation}
      />

      {semanticModel && (
        <DialogSourceViewDialog
          open={uiState.sourceViewOpen}
          onClose={() => uiState.setSourceViewOpen(false)}
          dialogName={dialogName}
          semanticModel={semanticModel}
        />
      )}

      <Snackbar
        open={uiState.snackbar.open}
        autoHideDuration={4000}
        onClose={() => uiState.setSnackbar({ ...uiState.snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => uiState.setSnackbar({ ...uiState.snackbar, open: false })}
          severity={uiState.snackbar.severity}
          sx={{ width: '100%' }}
        >
          {uiState.snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DialogDetailsEditor;
