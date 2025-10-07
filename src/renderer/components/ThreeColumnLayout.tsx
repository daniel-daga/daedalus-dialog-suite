import React, { useState } from 'react';
import { Box, Paper, Typography, List, ListItem, ListItemButton, ListItemText, Stack, TextField, Button, IconButton, Card, CardContent, Chip, Select, MenuItem, FormControl, InputLabel, FormHelperText, Tooltip, Menu } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Save as SaveIcon, Info as InfoIcon, MoreVert as MoreVertIcon } from '@mui/icons-material';
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
                action={action}
                index={idx}
                onUpdate={(updated) => updateAction(idx, updated)}
                onDelete={() => deleteAction(idx)}
                dialog={localDialog}
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
  dialog: any;
}

const ActionCard: React.FC<ActionCardProps> = ({ action, index, onUpdate, onDelete, dialog }) => {
  // Determine action type
  const isDialogLine = action.speaker !== undefined && action.text !== undefined && action.id !== undefined;
  const isChoice = action.dialogRef !== undefined && action.targetFunction !== undefined;
  const isCreateTopic = action.topic !== undefined && action.topicType !== undefined;
  const isLogEntry = action.topic !== undefined && action.text !== undefined && !action.topicType;
  const isChapterTransition = action.chapter !== undefined && action.world !== undefined;
  const isExchangeRoutine = (action.npc !== undefined || action.target !== undefined) && action.routine !== undefined;
  const isAction = action.action !== undefined;
  const isUnknown = !isDialogLine && !isChoice && !isCreateTopic && !isLogEntry && !isChapterTransition && !isExchangeRoutine && !isAction;

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

  return (
    <Box sx={{ pb: 2, mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {getActionTypeLabel()}
      </Typography>

      <Stack spacing={2}>
          {isDialogLine && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FormControl size="small" sx={{ width: 150, flexShrink: 0 }}>
                <InputLabel>Speaker</InputLabel>
                <Select
                  value={action.speaker || 'self'}
                  label="Speaker"
                  onChange={(e) => onUpdate({ ...action, speaker: e.target.value })}
                >
                  <MenuItem value="self">{dialog.properties?.npc || 'NPC'}</MenuItem>
                  <MenuItem value="other">Hero</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="Text"
                value={action.text || ''}
                onChange={(e) => onUpdate({ ...action, text: e.target.value })}
                size="small"
              />
              {action.id && (
                <Tooltip title={`Dialog ID: ${action.id}`} arrow>
                  <IconButton size="small" sx={{ flexShrink: 0 }}>
                    <InfoIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <IconButton size="small" color="error" onClick={onDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isChoice && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <TextField
                  fullWidth
                  label="Text"
                  value={action.text || ''}
                  onChange={(e) => onUpdate({ ...action, text: e.target.value })}
                  size="small"
                  multiline
                  rows={2}
                />
                <IconButton size="small" color="error" onClick={onDelete} sx={{ flexShrink: 0, mt: 0.5 }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
              <TextField
                fullWidth
                label="Target Function"
                value={action.targetFunction || ''}
                onChange={(e) => onUpdate({ ...action, targetFunction: e.target.value })}
                size="small"
                helperText="Function to call when this choice is selected"
              />
            </Box>
          )}
          {isCreateTopic && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                label="Topic"
                value={action.topic || ''}
                onChange={(e) => onUpdate({ ...action, topic: e.target.value })}
                size="small"
                sx={{ minWidth: 180 }}
              />
              <TextField
                fullWidth
                label="Topic Type"
                value={action.topicType || ''}
                onChange={(e) => onUpdate({ ...action, topicType: e.target.value })}
                size="small"
              />
              <IconButton size="small" color="error" onClick={onDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isLogEntry && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                label="Topic"
                value={action.topic || ''}
                onChange={(e) => onUpdate({ ...action, topic: e.target.value })}
                size="small"
                sx={{ minWidth: 180 }}
              />
              <TextField
                fullWidth
                label="Text"
                value={action.text || ''}
                onChange={(e) => onUpdate({ ...action, text: e.target.value })}
                size="small"
              />
              <IconButton size="small" color="error" onClick={onDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isChapterTransition && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                label="Chapter"
                type="number"
                value={action.chapter || ''}
                onChange={(e) => onUpdate({ ...action, chapter: parseInt(e.target.value) || 0 })}
                size="small"
                sx={{ width: 100 }}
              />
              <TextField
                fullWidth
                label="World"
                value={action.world || ''}
                onChange={(e) => onUpdate({ ...action, world: e.target.value })}
                size="small"
              />
              <IconButton size="small" color="error" onClick={onDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isExchangeRoutine && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                label="Target NPC"
                value={action.target || action.npc || ''}
                onChange={(e) => {
                  const updated = { ...action, routine: action.routine };
                  if (action.target !== undefined) {
                    updated.target = e.target.value;
                    delete updated.npc;
                  } else {
                    updated.npc = e.target.value;
                    delete updated.target;
                  }
                  onUpdate(updated);
                }}
                size="small"
                sx={{ width: 120 }}
              />
              <TextField
                fullWidth
                label="Routine"
                value={action.routine || ''}
                onChange={(e) => onUpdate({ ...action, routine: e.target.value })}
                size="small"
              />
              <IconButton size="small" color="error" onClick={onDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isAction && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <TextField
                fullWidth
                label="Action"
                value={action.action || ''}
                onChange={(e) => onUpdate({ ...action, action: e.target.value })}
                size="small"
                multiline
                rows={2}
              />
              <IconButton size="small" color="error" onClick={onDelete} sx={{ flexShrink: 0, mt: 0.5 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isUnknown && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" color="warning.main" gutterBottom>
                    This action type is not recognized. Fields detected:
                  </Typography>
                  <TextField
                    fullWidth
                    label="Raw JSON"
                    value={JSON.stringify(action, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        onUpdate(parsed);
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
                    Properties: {Object.keys(action).join(', ')}
                  </Typography>
                </Box>
                <IconButton size="small" color="error" onClick={onDelete} sx={{ flexShrink: 0 }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          )}
      </Stack>
    </Box>
  );
};

export default ThreeColumnLayout;