import React, { useState, useMemo, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Alert,
} from '@mui/material';
import { useProjectStore } from '../../store/projectStore';

export interface VariableCreationDialogProps {
  open: boolean;
  onClose: () => void;
  initialName?: string;
  initialType?: string;
  isConstant?: boolean;
}

const VariableCreationDialog: React.FC<VariableCreationDialogProps> = ({
  open,
  onClose,
  initialName = '',
  initialType = 'int',
  isConstant: initialIsConstant = false,
}) => {
  const { addVariable, questFiles, allDialogFiles, isLoading } = useProjectStore();
  
  const [newName, setNewName] = useState(initialName);
  const [newType, setNewType] = useState(initialType);
  const [newValue, setNewValue] = useState('');
  const [targetFile, setTargetFile] = useState('');
  const [isConstant, setIsConstant] = useState(initialIsConstant);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNewName(initialName);
      setNewType(initialType);
      setIsConstant(initialIsConstant);
      setError(null);
    }
  }, [open, initialName, initialType, initialIsConstant]);

  const availableFiles = useMemo(() => {
    // Combine and unique
    return Array.from(new Set([...questFiles, ...allDialogFiles])).sort();
  }, [questFiles, allDialogFiles]);

  // Try to pick a default file (e.g. from questFiles if available)
  useEffect(() => {
    if (open && !targetFile && availableFiles.length > 0) {
      // Prefer files with "Constants" or "Vars" in name
      const defaultFile = availableFiles.find(f => 
        f.toLowerCase().includes('constants') || 
        f.toLowerCase().includes('vars') || 
        f.toLowerCase().includes('log_')
      ) || availableFiles[0];
      setTargetFile(defaultFile);
    }
  }, [open, availableFiles, targetFile]);

  const handleAddSubmit = async () => {
    if (!newName || !targetFile) {
      setError('Name and File are required');
      return;
    }

    // Basic validation
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newName)) {
      setError('Invalid name format. Use only letters, numbers, and underscores.');
      return;
    }

    try {
      await addVariable(newName, newType, newValue, targetFile, isConstant);
      onClose();
      // Reset form
      setNewValue('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add variable');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add New Variable/Constant</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="e.g. MIS_MyQuest"
            fullWidth
            autoFocus
          />

          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={newType}
                label="Type"
                onChange={e => setNewType(e.target.value as any)}
              >
                <MenuItem value="int">int</MenuItem>
                <MenuItem value="string">string</MenuItem>
                <MenuItem value="func">func</MenuItem>
                <MenuItem value="float">float</MenuItem>
              </Select>
            </FormControl>

            <FormControlLabel
              control={<Switch checked={isConstant} onChange={e => setIsConstant(e.target.checked)} />}
              label="Constant"
            />
          </Box>

          {isConstant && (
            <TextField
              label="Value"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              fullWidth
            />
          )}

          <FormControl fullWidth>
            <InputLabel>Target File</InputLabel>
            <Select
              value={targetFile}
              label="Target File"
              onChange={e => setTargetFile(e.target.value)}
            >
              {availableFiles.map(f => (
                <MenuItem key={f} value={f}>
                  {f.split(/[\/]/).pop()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleAddSubmit} variant="contained" disabled={isLoading}>
          {isLoading ? 'Adding...' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default VariableCreationDialog;
