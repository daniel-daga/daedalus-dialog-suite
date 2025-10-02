import React, { useState } from 'react';
import { Box, Paper, Typography, List, ListItem, ListItemButton, ListItemText, Divider, Stack, TextField, Button, IconButton, Card, CardContent, Chip } from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, Save as SaveIcon } from '@mui/icons-material';
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
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Column 1: NPC List */}
      <Paper sx={{ width: 250, overflow: 'auto', borderRadius: 0 }} elevation={1}>
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
      <Paper sx={{ width: 300, overflow: 'auto', borderRadius: 0, borderLeft: 1, borderRight: 1, borderColor: 'divider' }} elevation={1}>
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
      <Box sx={{ flex: 1, overflow: 'auto', p: 2, minWidth: 0 }}>
        {selectedDialog && dialogData ? (
          <Box sx={{ width: '100%', maxWidth: '100%' }}>
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
  const { openFiles, saveFile } = useEditorStore();
  const fileState = openFiles.get(filePath);

  // Reset local state when dialog changes
  React.useEffect(() => {
    setLocalDialog(dialog);
    setLocalFunction(infoFunction);
  }, [dialogName, dialog, infoFunction]);

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

  const updateAction = (index: number, updatedAction: any) => {
    if (!localFunction) return;
    const newActions = [...(localFunction.actions || [])];
    newActions[index] = updatedAction;
    setLocalFunction({ ...localFunction, actions: newActions });
  };

  const deleteAction = (index: number) => {
    if (!localFunction) return;
    const newActions = (localFunction.actions || []).filter((_: any, i: number) => i !== index);
    setLocalFunction({ ...localFunction, actions: newActions });
  };

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

  const isDirty = JSON.stringify(dialog) !== JSON.stringify(localDialog) ||
                  JSON.stringify(infoFunction) !== JSON.stringify(localFunction);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5">{dialogName}</Typography>
          {fileState?.isDirty && <Chip label="File Modified" size="small" color="warning" sx={{ ml: 1 }} />}
          {isDirty && <Chip label="Unsaved Changes" size="small" color="error" sx={{ ml: 1 }} />}
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
          </Stack>
        </Box>

        {!localFunction || (localFunction.actions || []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No dialog actions yet. Click "Add Line" or "Add Choice" to create one.
          </Typography>
        ) : (
          <Stack spacing={2}>
            {(localFunction.actions || []).map((action: any, idx: number) => (
              <ActionCard
                key={idx}
                action={action}
                index={idx}
                onUpdate={(updated) => updateAction(idx, updated)}
                onDelete={() => deleteAction(idx)}
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
  onUpdate: (action: any) => void;
  onDelete: () => void;
}

const ActionCard: React.FC<ActionCardProps> = ({ action, index, onUpdate, onDelete }) => {
  const [expanded, setExpanded] = useState(false);

  // Determine action type
  const isDialogLine = action.speaker !== undefined && action.text !== undefined && action.id !== undefined;
  const isChoice = action.dialogRef !== undefined && action.targetFunction !== undefined;
  const isCreateTopic = action.topic !== undefined && action.topicType !== undefined;
  const isLogEntry = action.topic !== undefined && action.text !== undefined && !action.topicType;
  const isAction = action.action !== undefined;

  const getActionTypeLabel = () => {
    if (isDialogLine) return 'Dialog Line';
    if (isChoice) return 'Choice';
    if (isCreateTopic) return 'Create Topic';
    if (isLogEntry) return 'Log Entry';
    if (isAction) return 'Action';
    return 'Unknown';
  };

  const getActionSummary = () => {
    if (isDialogLine) return `${action.speaker}: ${action.text}`;
    if (isChoice) return action.text;
    if (isCreateTopic) return `Create topic: ${action.topic}`;
    if (isLogEntry) return `Log: ${action.text}`;
    if (isAction) return action.action;
    return JSON.stringify(action);
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: expanded ? 2 : 0 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              #{index + 1} - {getActionTypeLabel()}
            </Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
              {getActionSummary()}
            </Typography>
            {isChoice && action.targetFunction && (
              <Typography variant="caption" color="primary">
                → {action.targetFunction}()
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={0.5}>
            <IconButton size="small" onClick={() => setExpanded(!expanded)}>
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" color="error" onClick={onDelete}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>

        {expanded && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            {isDialogLine && (
              <>
                <TextField
                  fullWidth
                  label="Speaker"
                  value={action.speaker || ''}
                  onChange={(e) => onUpdate({ ...action, speaker: e.target.value })}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Text"
                  value={action.text || ''}
                  onChange={(e) => onUpdate({ ...action, text: e.target.value })}
                  size="small"
                  multiline
                  rows={3}
                />
                <TextField
                  fullWidth
                  label="Dialog ID"
                  value={action.id || ''}
                  onChange={(e) => onUpdate({ ...action, id: e.target.value })}
                  size="small"
                />
              </>
            )}
            {isChoice && (
              <>
                <TextField
                  fullWidth
                  label="Text"
                  value={action.text || ''}
                  onChange={(e) => onUpdate({ ...action, text: e.target.value })}
                  size="small"
                  multiline
                  rows={2}
                />
                <TextField
                  fullWidth
                  label="Target Function"
                  value={action.targetFunction || ''}
                  onChange={(e) => onUpdate({ ...action, targetFunction: e.target.value })}
                  size="small"
                  helperText="Function to call when this choice is selected"
                />
              </>
            )}
            {isCreateTopic && (
              <>
                <TextField
                  fullWidth
                  label="Topic"
                  value={action.topic || ''}
                  onChange={(e) => onUpdate({ ...action, topic: e.target.value })}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Topic Type"
                  value={action.topicType || ''}
                  onChange={(e) => onUpdate({ ...action, topicType: e.target.value })}
                  size="small"
                />
              </>
            )}
            {isLogEntry && (
              <>
                <TextField
                  fullWidth
                  label="Topic"
                  value={action.topic || ''}
                  onChange={(e) => onUpdate({ ...action, topic: e.target.value })}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Text"
                  value={action.text || ''}
                  onChange={(e) => onUpdate({ ...action, text: e.target.value })}
                  size="small"
                  multiline
                  rows={2}
                />
              </>
            )}
            {isAction && (
              <TextField
                fullWidth
                label="Action"
                value={action.action || ''}
                onChange={(e) => onUpdate({ ...action, action: e.target.value })}
                size="small"
                multiline
                rows={2}
              />
            )}
            <Button size="small" variant="outlined" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default ThreeColumnLayout;