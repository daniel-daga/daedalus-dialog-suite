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
import type { GlobalConstant, GlobalVariable } from '../types/global';

const VariableManager: React.FC = () => {
  const { mergedSemanticModel, addVariable, deleteVariable, allDialogFiles, questFiles, isLoading } = useProjectStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'constants' | 'variables'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Add Variable Dialog State
  const [openAdd, setOpenAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('int');
  const [newValue, setNewValue] = useState('');
  const [targetFile, setTargetFile] = useState('');
  const [isConstant, setIsConstant] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variables = useMemo(() => {
    const vars: ((GlobalConstant | GlobalVariable) & { isConstant: boolean })[] = [];
    if (mergedSemanticModel.constants) {
      vars.push(...Object.values(mergedSemanticModel.constants).map(c => ({ ...c, isConstant: true })));
    }
    if (mergedSemanticModel.variables) {
      vars.push(...Object.values(mergedSemanticModel.variables).map(v => ({ ...v, isConstant: false })));
    }
    // Sort by name
    return vars.sort((a, b) => a.name.localeCompare(b.name));
  }, [mergedSemanticModel]);

  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    variables.forEach(v => {
      if (v.type) types.add(v.type.toLowerCase());
    });
    return Array.from(types).sort();
  }, [variables]);

  const filteredVariables = useMemo(() => {
    let result = variables;

    // Category filter
    if (categoryFilter === 'constants') {
      result = result.filter(v => v.isConstant);
    } else if (categoryFilter === 'variables') {
      result = result.filter(v => !v.isConstant);
    }

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter(v => v.type.toLowerCase() === typeFilter);
    }

    // Search query
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(v =>
        v.name.toLowerCase().includes(lowerQuery) ||
        v.type.toLowerCase().includes(lowerQuery) ||
        (v.filePath && v.filePath.toLowerCase().includes(lowerQuery))
      );
    }

    return result;
  }, [variables, searchQuery, categoryFilter, typeFilter]);

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

  const handleDelete = async (v: GlobalConstant | GlobalVariable) => {
      if (!v.filePath || !v.range) {
          // Cannot delete if no file path or range (e.g. implicitly defined or legacy parser)
          return;
      }
      if (confirm(`Are you sure you want to delete ${v.name}?`)) {
          try {
              await deleteVariable(v.filePath, v.range);
          } catch (e) {
              console.error(e);
              alert('Failed to delete variable: ' + (e instanceof Error ? e.message : String(e)));
          }
      }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 2, gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5">Variable Manager</Typography>
        <Box sx={{ flexGrow: 1 }} />

        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Category</InputLabel>
          <Select
            value={categoryFilter}
            label="Category"
            onChange={(e) => setCategoryFilter(e.target.value as any)}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="constants">Constants</MenuItem>
            <MenuItem value="variables">Variables</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Type</InputLabel>
          <Select
            value={typeFilter}
            label="Type"
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <MenuItem value="all">All Types</MenuItem>
            {availableTypes.map(t => (
              <MenuItem key={t} value={t}>{t}</MenuItem>
            ))}
          </Select>
        </FormControl>

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
          inputProps={{
            'aria-label': 'Search variables'
          }}
          sx={{ width: 200 }}
        />

        <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpenAdd(true)}
        >
            Add Variable
        </Button>
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
                <TableCell sx={{ fontFamily: 'monospace' }}>
                  {v.name}
                  {v.isConstant && (
                    <Chip label="const" size="small" sx={{ ml: 1, height: 16, fontSize: '0.6rem' }} />
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    label={v.type}
                    size="small"
                    color={v.isConstant ? 'primary' : 'default'}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  {v.isConstant ? String((v as GlobalConstant).value) : '-'}
                </TableCell>
                <TableCell>
                  <Tooltip title={v.filePath || ''}>
                    <Typography variant="caption" noWrap sx={{ maxWidth: 200, display: 'block' }}>
                      {v.filePath ? v.filePath.split(/[\\/]/).pop() : 'Unknown'}
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                    <Tooltip title="Delete variable">
                        <span>
                            <IconButton
                                size="small"
                                onClick={() => handleDelete(v)}
                                disabled={!v.filePath || !v.range}
                                color="error"
                                aria-label="Delete variable"
                            >
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
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
              <Button onClick={handleAddSubmit} variant="contained" disabled={isLoading}>
                  {isLoading ? 'Adding...' : 'Add'}
              </Button>
          </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VariableManager;