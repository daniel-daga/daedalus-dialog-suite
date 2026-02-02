import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Stack,
  Alert
} from '@mui/material';
import { useProjectStore } from '../store/projectStore';

interface CreateQuestDialogProps {
  open: boolean;
  onClose: () => void;
}

const CreateQuestDialog: React.FC<CreateQuestDialogProps> = ({ open, onClose }) => {
  const { mergedSemanticModel, createQuest, isLoading } = useProjectStore();

  const [title, setTitle] = useState('');
  const [internalName, setInternalName] = useState('');
  const [topicFile, setTopicFile] = useState('');
  const [variableFile, setVariableFile] = useState('');
  const [isInternalNameTouched, setIsInternalNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Analyze existing quests to find common files
  const fileSuggestions = useMemo(() => {
    const topicFiles = new Map<string, number>();
    const varFiles = new Map<string, number>();

    Object.values(mergedSemanticModel.constants || {}).forEach(c => {
        if (c.name.startsWith('TOPIC_') && c.filePath) {
            topicFiles.set(c.filePath, (topicFiles.get(c.filePath) || 0) + 1);
        }
    });

    Object.values(mergedSemanticModel.variables || {}).forEach(v => {
        if (v.name.startsWith('MIS_') && v.filePath) {
            varFiles.set(v.filePath, (varFiles.get(v.filePath) || 0) + 1);
        }
    });

    // Sort by frequency
    const sortedTopicFiles = Array.from(topicFiles.entries())
        .sort((a, b) => b[1] - a[1])
        .map(e => e[0]);

    const sortedVarFiles = Array.from(varFiles.entries())
        .sort((a, b) => b[1] - a[1])
        .map(e => e[0]);

    return {
        topics: sortedTopicFiles,
        variables: sortedVarFiles
    };
  }, [mergedSemanticModel]);

  // Set default files when opening
  useEffect(() => {
    if (open) {
        if (fileSuggestions.topics.length > 0) setTopicFile(fileSuggestions.topics[0]);
        if (fileSuggestions.variables.length > 0) setVariableFile(fileSuggestions.variables[0]);
    }
  }, [open, fileSuggestions]);

  // Auto-generate internal name
  useEffect(() => {
    if (!isInternalNameTouched && title) {
        // "The Lost Sheep" -> "LostSheep" (remove articles, remove spaces)
        const generated = title
            .replace(/^(The|A|An)\s+/i, '')
            .replace(/[^a-zA-Z0-9]/g, '');
        setInternalName(generated);
    }
  }, [title, isInternalNameTouched]);

  const handleSubmit = async () => {
    if (!title || !internalName || !topicFile || !variableFile) {
        setError('All fields are required');
        return;
    }

    // Check for duplicate names
    if (mergedSemanticModel.constants?.[`TOPIC_${internalName}`]) {
        setError(`TOPIC_${internalName} already exists`);
        return;
    }
    if (mergedSemanticModel.variables?.[`MIS_${internalName}`]) {
        setError(`MIS_${internalName} already exists`);
        return;
    }

    try {
        await createQuest(title, internalName, topicFile, variableFile);
        onClose();
        // Reset form
        setTitle('');
        setInternalName('');
        setIsInternalNameTouched(false);
        setError(null);
    } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const formatPath = (path: string) => {
      // Show only filename if possible, or relative path
      // Since we don't have project root handy here (it's in store),
      // we'll just show the last part for now or full path.
      const parts = path.split(/[/\\]/);
      return parts[parts.length - 1];
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create New Quest</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
                label="Quest Title"
                placeholder="e.g. The Lost Sheep"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                fullWidth
            />

            <TextField
                label="Internal Name"
                placeholder="e.g. LostSheep"
                value={internalName}
                onChange={(e) => {
                    setInternalName(e.target.value);
                    setIsInternalNameTouched(true);
                }}
                helperText={`Will create: TOPIC_${internalName || '...'} and MIS_${internalName || '...'}`}
                fullWidth
            />

            <FormControl fullWidth>
                <InputLabel>Quest Definition File (TOPIC_)</InputLabel>
                <Select
                    value={topicFile}
                    label="Quest Definition File (TOPIC_)"
                    onChange={(e) => setTopicFile(e.target.value)}
                >
                    {fileSuggestions.topics.map(f => (
                        <MenuItem key={f} value={f}>{formatPath(f)}</MenuItem>
                    ))}
                </Select>
                <FormHelperText>{topicFile}</FormHelperText>
            </FormControl>

            <FormControl fullWidth>
                <InputLabel>Variable Definition File (MIS_)</InputLabel>
                <Select
                    value={variableFile}
                    label="Variable Definition File (MIS_)"
                    onChange={(e) => setVariableFile(e.target.value)}
                >
                    {fileSuggestions.variables.map(f => (
                        <MenuItem key={f} value={f}>{formatPath(f)}</MenuItem>
                    ))}
                </Select>
                <FormHelperText>{variableFile}</FormHelperText>
            </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Create Quest'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateQuestDialog;
