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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { Search as SearchIcon, Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useProjectStore } from '../store/projectStore';
import type { GlobalConstant, GlobalVariable } from '../types/global';
import VariableCreationDialog from './common/VariableCreationDialog';

const VariableManager: React.FC = () => {
  const { mergedSemanticModel, deleteVariable, allDialogFiles, questFiles } = useProjectStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'constants' | 'variables'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Add Variable Dialog State
  const [openAdd, setOpenAdd] = useState(false);

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

      <VariableCreationDialog 
        open={openAdd} 
        onClose={() => setOpenAdd(false)} 
      />
    </Box>
  );
};

export default VariableManager;
