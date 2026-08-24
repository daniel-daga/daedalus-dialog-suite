import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Stack,
  Button,
  IconButton,
  Tooltip,
  Snackbar,
  Alert,
} from '@mui/material';
import {
  Code as CodeIcon,
  Difference as DifferenceIcon,
  Undo as UndoIcon,
  Redo as RedoIcon,
  Delete as DeleteIcon,
  DriveFileRenameOutline as RenameIcon,
} from '@mui/icons-material';
import { useEditorStore } from '../store/editorStore';
import { useHistoryStore } from '../store/historyStore';
import * as historyActions from '../store/historyActions';
import { DialogDetailsEditorProps } from './dialogTypes';
import ValidationErrorDialog from './ValidationErrorDialog';
import ReviewChangesDialog from './ReviewChangesDialog';
import { flushAllPendingEdits } from '../utils/pendingEditFlushRegistry';
import DialogPropertiesSection from './DialogPropertiesSection';
import ConditionSection from './ConditionSection';
import DialogActionsSection from './DialogActionsSection';
import { useFocusNavigation } from './hooks/useFocusNavigation';
import { useActionManagement } from './hooks/useActionManagement';
import { useDialogEditorUIState } from './hooks/useDialogEditorUIState';
import { useDialogEditorCommands } from './hooks/useDialogEditorCommands';
import { flattenActionPaths } from './nestedActionUtils';
import SimulatorDialog from './Simulator/SimulatorDialog';

// Monaco lives behind this dialog and is the heaviest thing the renderer can
// load; keep it out of the entry chunk and off the first paint (§3 P3).
const DialogSourceViewDialog = lazy(() => import('./DialogSourceViewDialog'));

const DialogDetailsEditor: React.FC<DialogDetailsEditorProps> = ({
  dialogName,
  filePath,
  functionName,
  onNavigateToFunction,
  semanticModel: passedSemanticModel,
  onDeleteDialog,
  onRenameDialog,
}) => {
  const fileState = useEditorStore((s) => (filePath ? s.openFiles.get(filePath) ?? null : null));
  const saveFile = useEditorStore((s) => s.saveFile);
  const semanticModel = fileState?.semanticModel || passedSemanticModel;

  const dialog = semanticModel?.dialogs?.[dialogName];
  const informationFunctionName = typeof dialog?.properties?.information === 'string'
    ? dialog.properties.information
    : dialog?.properties?.information?.name;
  const currentFunctionName = functionName || informationFunctionName || null;
  const currentFunction = currentFunctionName
    ? semanticModel?.functions?.[currentFunctionName] || null
    : null;

  const canUndo = useHistoryStore((state) => filePath ? state.canUndo(filePath) : false);
  const canRedo = useHistoryStore((state) => filePath ? state.canRedo(filePath) : false);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const uiState = useDialogEditorUIState();
  const { registerActionRef, focusAction, trimRefs } = useFocusNavigation();
  const [reviewChangesOpen, setReviewChangesOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  // The editor pane now stays mounted across dialog switches (it no longer
  // unmounts/remounts, which used to reset this UI state for free). Reset
  // the per-dialog fields explicitly whenever the dialog being edited
  // changes. Transient in-flight flags (isSaving, isResetting) are left
  // alone — they track an operation on the current dialog, not per-dialog
  // display state.
  useEffect(() => {
    uiState.setPropertiesExpanded(false);
    uiState.setSourceViewOpen(false);
    setReviewChangesOpen(false);
    setSimulatorOpen(false);
    uiState.setSnackbar({ open: false, message: '', severity: 'info' });
    uiState.setValidationDialog({ open: false, validationResult: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogName]);

  const {
    setFunction,
    handleRenameFunction,
    addActionToEnd,
    handleDialogPropertyChange,
    handleConditionFunctionUpdate,
    handleSave,
    handleSaveAnyway,
    handleCancelValidation
  } = useDialogEditorCommands({
    dialogName,
    filePath,
    currentFunctionName,
    currentFunction,
    semanticModel,
    saveFile,
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
    addActionAfter,
    addActionToBranchEnd,
    moveAction
  } = useActionManagement({
    setFunction,
    focusAction,
    semanticModel,
    onUpdateSemanticModel: (functionNameToUpdate, updatedFunction) => {
      if (filePath) {
        historyActions.updateFunction(filePath, functionNameToUpdate, updatedFunction);
      }
    },
    contextName: dialogName,
    currentFunctionName
  });

  const visibleActionPaths = useMemo(
    () => flattenActionPaths(currentFunction?.actions || []),
    [currentFunction?.actions]
  );

  useEffect(() => {
    trimRefs(visibleActionPaths);
  }, [visibleActionPaths, trimRefs]);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h5">{dialogName}</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Tooltip title="Undo (Ctrl+Z)">
            <span>
              <IconButton
                size="small"
                disabled={!canUndo}
                onClick={() => filePath && undo(filePath)}
                aria-label="Undo"
              >
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Redo (Ctrl+Y)">
            <span>
              <IconButton
                size="small"
                disabled={!canRedo}
                onClick={() => filePath && redo(filePath)}
                aria-label="Redo"
              >
                <RedoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          {onRenameDialog && (
            <Tooltip title="Rename Dialog">
              <IconButton size="small" onClick={() => onRenameDialog(dialogName)} aria-label="Rename dialog">
                <RenameIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {onDeleteDialog && (
            <Tooltip title="Delete Dialog">
              <IconButton size="small" onClick={() => onDeleteDialog(dialogName)} aria-label="Delete dialog" sx={{ color: 'error.main' }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Review the changes that a save would write to disk">
            <span>
              <Button
                variant="outlined"
                disabled={!filePath || !fileState}
                onClick={() => {
                  // Drain any debounced edit so the diff reflects the latest
                  // keystroke (same flush the save path performs).
                  flushAllPendingEdits();
                  setReviewChangesOpen(true);
                }}
                startIcon={<DifferenceIcon />}
                data-testid="review-changes-button"
              >
                Review Changes
              </Button>
            </span>
          </Tooltip>
          <Button
            variant="outlined"
            disabled={!informationFunctionName || !semanticModel}
            onClick={() => setSimulatorOpen(true)}
            data-testid="simulator-launch"
          >
            Play dialog
          </Button>
          <Button
            variant="outlined"
            onClick={() => uiState.setSourceViewOpen(true)}
            startIcon={<CodeIcon />}
          >
            View Source
          </Button>
        </Stack>
      </Box>

      {dialog && (
        <>
          <DialogPropertiesSection
            dialog={dialog}
            semanticModel={semanticModel}
            propertiesExpanded={uiState.propertiesExpanded}
            onToggleExpanded={() => uiState.setPropertiesExpanded(!uiState.propertiesExpanded)}
            onDialogPropertyChange={handleDialogPropertyChange}
          />
          <ConditionSection
            dialogName={dialogName}
            dialog={dialog}
            semanticModel={semanticModel}
            filePath={filePath}
            onUpdateFunction={handleConditionFunctionUpdate}
          />
        </>
      )}

      {currentFunction && (
        <DialogActionsSection
          dialogName={dialogName}
          currentFunction={currentFunction}
          npcName={dialog?.properties?.npc || 'NPC'}
          updateActionAtPath={updateAction}
          deleteActionAtPath={deleteAction}
          deleteActionAndFocusPrevAtPath={deleteActionAndFocusPrev}
          addDialogLineAfterPath={addDialogLineAfter}
          addActionAfterPath={addActionAfter}
          addActionToBranchEnd={addActionToBranchEnd}
          moveAction={moveAction}
          focusActionAtPath={focusAction}
          registerActionRef={registerActionRef}
          getVisibleActionPaths={() => visibleActionPaths}
          onNavigateToFunction={onNavigateToFunction}
          onRenameFunction={handleRenameFunction}
          onAddActionToEnd={addActionToEnd}
          filePath={filePath}
        />
      )}

      <ValidationErrorDialog
        open={uiState.validationDialog.open}
        validationResult={uiState.validationDialog.validationResult}
        mode={uiState.validationDialog.mode}
        onClose={handleCancelValidation}
        onSaveAnyway={handleSaveAnyway}
        onCancel={handleCancelValidation}
      />

      {fileState && filePath && (
        <ReviewChangesDialog
          open={reviewChangesOpen}
          filePath={filePath}
          semanticModel={fileState.semanticModel}
          onSave={() => handleSave()}
          onClose={() => setReviewChangesOpen(false)}
        />
      )}

      {semanticModel && uiState.sourceViewOpen && (
        <Suspense fallback={null}>
          <DialogSourceViewDialog
            open
            onClose={() => uiState.setSourceViewOpen(false)}
            dialogName={dialogName}
            semanticModel={semanticModel}
          />
        </Suspense>
      )}

      {semanticModel && dialog && (
        <SimulatorDialog
          open={simulatorOpen}
          semanticModel={semanticModel}
          dialogName={dialogName}
          npcName={dialog.properties.npc || 'NPC'}
          onClose={() => setSimulatorOpen(false)}
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
