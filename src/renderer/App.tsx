import React, { useState } from 'react';
import {
  Box, AppBar, Toolbar, Typography, Button, Card, CardContent, Chip,
  TextField, IconButton, Divider, List, ListItem, ListItemText, Paper,
  Stack
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon, Save as SaveIcon } from '@mui/icons-material';
import { useEditorStore } from './store/editorStore';
import ThreeColumnLayout from './components/ThreeColumnLayout';

const ChoiceEditor: React.FC<{
  choice: any;
  index: number;
  onUpdate: (choice: any) => void;
  onDelete: () => void;
}> = ({ choice, index, onUpdate, onDelete }) => {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <ListItem
        secondaryAction={
          <Box>
            <IconButton edge="end" onClick={() => setEditing(true)} size="small">
              <EditIcon />
            </IconButton>
            <IconButton edge="end" onClick={onDelete} size="small" color="error">
              <DeleteIcon />
            </IconButton>
          </Box>
        }
      >
        <ListItemText
          primary={`${index + 1}. ${choice.text?.value || '(no text)'}`}
          secondary={choice.actions?.length > 0 ? `${choice.actions.length} action(s)` : 'No actions'}
        />
      </ListItem>
    );
  }

  return (
    <Paper sx={{ p: 2, mb: 1 }}>
      <TextField
        fullWidth
        label="Choice Text"
        value={choice.text?.value || ''}
        onChange={(e) => onUpdate({
          ...choice,
          text: { ...choice.text, value: e.target.value }
        })}
        margin="dense"
      />
      <TextField
        fullWidth
        label="Function"
        value={choice.function?.value || ''}
        onChange={(e) => onUpdate({
          ...choice,
          function: { ...choice.function, value: e.target.value }
        })}
        margin="dense"
        helperText="Function to call when this choice is selected"
      />
      <Box sx={{ mt: 2, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button size="small" onClick={() => setEditing(false)}>Done</Button>
      </Box>
    </Paper>
  );
};

const DialogEditor: React.FC<{
  name: string;
  dialog: any;
  filePath: string;
}> = ({ name, dialog, filePath }) => {
  const { updateModel, openFiles } = useEditorStore();
  const [editing, setEditing] = useState(false);
  const [localDialog, setLocalDialog] = useState(dialog);

  const handleUpdate = () => {
    const fileState = openFiles.get(filePath);
    if (fileState) {
      const updatedModel = {
        ...fileState.semanticModel,
        dialogs: {
          ...fileState.semanticModel.dialogs,
          [name]: localDialog
        }
      };
      updateModel(filePath, updatedModel);
      setEditing(false);
    }
  };

  const updateChoice = (index: number, updatedChoice: any) => {
    const newChoices = [...(localDialog.choices || [])];
    newChoices[index] = updatedChoice;
    setLocalDialog({ ...localDialog, choices: newChoices });
  };

  const deleteChoice = (index: number) => {
    const newChoices = (localDialog.choices || []).filter((_: any, i: number) => i !== index);
    setLocalDialog({ ...localDialog, choices: newChoices });
  };

  const addChoice = () => {
    const newChoice = {
      text: { value: 'New choice' },
      function: { value: '' },
      actions: []
    };
    setLocalDialog({
      ...localDialog,
      choices: [...(localDialog.choices || []), newChoice]
    });
  };

  if (!editing) {
    return (
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">{name}</Typography>
            <IconButton onClick={() => setEditing(true)} size="small">
              <EditIcon />
            </IconButton>
          </Box>

          {dialog.info && (
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Info: {dialog.info.value || 'N/A'}
            </Typography>
          )}

          {dialog.npc && (
            <Typography variant="body2" color="text.secondary" gutterBottom>
              NPC: {dialog.npc.value || 'N/A'}
            </Typography>
          )}

          {dialog.choices && dialog.choices.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2">Choices ({dialog.choices.length}):</Typography>
              {dialog.choices.map((choice: any, idx: number) => (
                <Box key={idx} sx={{ ml: 2, mt: 1 }}>
                  <Typography variant="body2">
                    {idx + 1}. {choice.text?.value || '(no text)'}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>{name}</Typography>

        <TextField
          fullWidth
          label="Info"
          value={localDialog.info?.value || ''}
          onChange={(e) => setLocalDialog({
            ...localDialog,
            info: { ...localDialog.info, value: e.target.value }
          })}
          margin="dense"
        />

        <TextField
          fullWidth
          label="NPC"
          value={localDialog.npc?.value || ''}
          onChange={(e) => setLocalDialog({
            ...localDialog,
            npc: { ...localDialog.npc, value: e.target.value }
          })}
          margin="dense"
        />

        <TextField
          fullWidth
          label="Condition"
          value={localDialog.condition?.value || ''}
          onChange={(e) => setLocalDialog({
            ...localDialog,
            condition: { ...localDialog.condition, value: e.target.value }
          })}
          margin="dense"
          helperText="Function that determines if this dialog is available"
        />

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1">Choices</Typography>
          <Button
            startIcon={<AddIcon />}
            size="small"
            onClick={addChoice}
          >
            Add Choice
          </Button>
        </Box>

        <List>
          {(localDialog.choices || []).map((choice: any, idx: number) => (
            <ChoiceEditor
              key={idx}
              choice={choice}
              index={idx}
              onUpdate={(updated) => updateChoice(idx, updated)}
              onDelete={() => deleteChoice(idx)}
            />
          ))}
        </List>

        <Box sx={{ mt: 2, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button onClick={() => { setEditing(false); setLocalDialog(dialog); }}>
            Cancel
          </Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleUpdate}>
            Save Changes
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
};

const FileContentView: React.FC<{ filePath: string }> = ({ filePath }) => {
  const { openFiles, saveFile } = useEditorStore();
  const fileState = openFiles.get(filePath);

  if (!fileState) {
    return <Typography>Loading...</Typography>;
  }

  const { semanticModel, isDirty } = fileState;
  const dialogCount = Object.keys(semanticModel.dialogs || {}).length;
  const functionCount = Object.keys(semanticModel.functions || {}).length;

  const handleSave = async () => {
    try {
      await saveFile(filePath);
    } catch (error) {
      console.error('Failed to save:', error);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h5" gutterBottom>
            File: {filePath.split('/').pop()}
            {isDirty && <Chip label="Modified" size="small" color="warning" sx={{ ml: 1 }} />}
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {filePath}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          disabled={!isDirty}
          onClick={handleSave}
        >
          Save
        </Button>
      </Box>

      <Box sx={{ mt: 3, mb: 2, display: 'flex', gap: 2 }}>
        <Chip label={`${dialogCount} Dialogs`} color="primary" />
        <Chip label={`${functionCount} Functions`} color="secondary" />
      </Box>

      {dialogCount > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" gutterBottom>Dialogs</Typography>
          {Object.entries(semanticModel.dialogs || {}).map(([name, dialog]: [string, any]) => (
            <DialogEditor key={name} name={name} dialog={dialog} filePath={filePath} />
          ))}
        </Box>
      )}

      {functionCount > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" gutterBottom>Functions</Typography>
          {Object.keys(semanticModel.functions || {}).map((name) => (
            <Card key={name} sx={{ mb: 1 }}>
              <CardContent>
                <Typography variant="body1">{name}()</Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {dialogCount === 0 && functionCount === 0 && (
        <Typography color="text.secondary">No dialogs or functions found in this file.</Typography>
      )}
    </Box>
  );
};

const App: React.FC = () => {
  const { openFile, activeFile } = useEditorStore();

  const handleOpenFile = async () => {
    const filePath = await window.editorAPI.openFileDialog();
    if (filePath) {
      await openFile(filePath);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Dandelion
          </Typography>
          <Button color="inherit" onClick={handleOpenFile}>
            Open File
          </Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden' }}>
        {activeFile ? (
          <ThreeColumnLayout filePath={activeFile} />
        ) : (
          <Box sx={{ flex: 1, p: 2, overflow: 'auto' }}>
            <Typography>No file open. Click "Open File" to get started.</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default App;