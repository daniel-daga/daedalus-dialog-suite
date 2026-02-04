import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  InputAdornment,
  Chip,
  Tooltip,
  Button,
  IconButton,
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
import { Search as SearchIcon, Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useProjectStore } from '../store/projectStore';
import type { GlobalConstant, GlobalVariable, GlobalSymbol } from '../types/global';

const VariableManager: React.FC = () => {
  const { mergedSemanticModel, addVariable, deleteVariable, allDialogFiles, questFiles, symbols } = useProjectStore();
  const [searchQuery, setSearchQuery] = useState('');

  // Add Variable Dialog State
  const [openAdd, setOpenAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('int');
  const [newValue, setNewValue] = useState('');
  const [targetFile, setTargetFile] = useState('');
  const [isConstant, setIsConstant] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variables = useMemo(() => {
    // Priority: Use symbols from lightweight index (covers all files)
    if (symbols && symbols.size > 0) {
        return Array.from(symbols.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    // Fallback: Use parsed model (e.g. single file mode or empty project index)
    const vars: (GlobalConstant | GlobalVariable | GlobalSymbol)[] = [];
    if (mergedSemanticModel.constants) {
      vars.push(...Object.values(mergedSemanticModel.constants));
    }
    if (mergedSemanticModel.variables) {
      vars.push(...Object.values(mergedSemanticModel.variables));
    }
    // Sort by name
    return vars.sort((a, b) => a.name.localeCompare(b.name));
  }, [mergedSemanticModel, symbols]);

  const filteredVariables = useMemo(() => {
    if (!searchQuery) return variables;
    const lowerQuery = searchQuery.toLowerCase();
    return variables.filter(v =>
      v.name.toLowerCase().includes(lowerQuery) ||
      v.type.toLowerCase().includes(lowerQuery) ||
      (v.filePath && v.filePath.toLowerCase().includes(lowerQuery))
    );
  }, [variables, searchQuery]);

  const availableFiles = useMemo(() => {
      // Combine and unique
      return Array.from(new Set([...questFiles, ...allDialogFiles])).sort();
  }, [questFiles, allDialogFiles]);

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
          setOpenAdd(false);
          // Reset form
          setNewName('');
          setNewType('int');
          setNewValue('');
          setIsConstant(false);
          setError(null);
      } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to add variable');
      }
  };

  const handleDelete = async (v: GlobalConstant | GlobalVariable | GlobalSymbol) => {
      // For lightweight symbols, we might not have 'range' if it came from regex scan (which captures basic info).
      // However, we can re-scan or rely on parsing.
      // Actually, extractFileMetadata DOES NOT return range for symbols currently.
      // This is a limitation. If we want to delete, we might need to parse the file or find it via regex again.
      // But `ProjectStore.deleteVariable` requires a range.

      if (!v.filePath) return;

      // Strategy: If range is missing (from regex symbol), we can't easily delete via byte range.
      // We might need to implement "deleteByName" or just force parse the file first.

      // Check if it has range (parsed model symbol)
      const hasRange = 'range' in v && v.range;

      if (!hasRange) {
         // It's a lightweight symbol. We can try to open the file and find it,
         // or we can tell the user they need to open the file first?
         // Better UX: The store action `deleteVariable` takes range.
         // We should update `deleteVariable` to accept Name + FilePath, or compute range here.
         alert("Please open the file containing this variable to delete it (Lazy loading limitation: precise location not loaded yet).");
         return;
      }

      // Cast to type with range (checked above)
      const symbolWithRange = v as (GlobalConstant | GlobalVariable);

      if (confirm(`Are you sure you want to delete ${v.name}?`)) {
          try {
              await deleteVariable(v.filePath, symbolWithRange.range!);
          } catch (e) {
              console.error(e);
              alert('Failed to delete variable: ' + (e instanceof Error ? e.message : String(e)));
          }
      }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 2, gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="h5">Variable Manager</Typography>
        <Box sx={{ flexGrow: 1 }} />

        <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpenAdd(true)}
        >
            Add Variable
        </Button>

        <TextField
          size="small"
          placeholder="Search variables..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          sx={{ width: 300 }}
        />
      </Box>

      <TableContainer component={Paper} variant="outlined" sx={{ flexGrow: 1 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>File</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredVariables.map((v) => (
              <TableRow key={`${v.name}-${v.filePath}`} hover>
                <TableCell sx={{ fontFamily: 'monospace' }}>{v.name}</TableCell>
                <TableCell>
                  <Chip
                    label={v.type}
                    size="small"
                    color={'value' in v && v.value !== undefined ? 'primary' : 'default'}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  {'value' in v ? String(v.value) : '-'}
                </TableCell>
                <TableCell>
                  <Tooltip title={v.filePath || ''}>
                    <Typography variant="caption" noWrap sx={{ maxWidth: 200, display: 'block' }}>
                      {v.filePath ? v.filePath.split(/[\\/]/).pop() : 'Unknown'}
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                    <IconButton
                        size="small"
                        onClick={() => handleDelete(v)}
                        disabled={!v.filePath || !('range' in v)}
                        color="error"
                        title={!('range' in v) ? "Open file to enable deletion" : "Delete variable"}
                    >
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {filteredVariables.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    No variables found
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Add Dialog */}
      <Dialog open={openAdd} onClose={() => setOpenAdd(false)} maxWidth="sm" fullWidth>
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
                  />

                  <Box sx={{ display: 'flex', gap: 2 }}>
                      <FormControl fullWidth>
                          <InputLabel>Type</InputLabel>
                          <Select
                              value={newType}
                              label="Type"
                              onChange={e => setNewType(e.target.value)}
                          >
                              <MenuItem value="int">int</MenuItem>
                              <MenuItem value="string">string</MenuItem>
                              <MenuItem value="func">func</MenuItem>
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
                                  {f.split(/[\\/]/).pop()}
                              </MenuItem>
                          ))}
                      </Select>
                  </FormControl>
              </Box>
          </DialogContent>
          <DialogActions>
              <Button onClick={() => setOpenAdd(false)}>Cancel</Button>
              <Button onClick={handleAddSubmit} variant="contained">Add</Button>
          </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VariableManager;
