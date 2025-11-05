import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Box, Paper, Typography, Stack, IconButton, Button, Menu, MenuItem, Chip } from '@mui/material';
import { Add as AddIcon, ExpandMore as ExpandMoreIcon, ChevronRight as ChevronRightIcon, Delete as DeleteIcon, Code as CodeIcon, Check as CheckIcon, NotInterested as NotInterestedIcon, Info as InfoIcon } from '@mui/icons-material';
import ConditionCard from './ConditionCard';

interface ConditionEditorProps {
  conditionFunction: any;
  onUpdateFunction: (func: any) => void;
  semanticModel?: any;
  filePath: string;
  dialogName: string;
}

const ConditionEditor: React.FC<ConditionEditorProps> = ({
  conditionFunction,
  onUpdateFunction,
  semanticModel,
  filePath,
  dialogName
}) => {
  const [localFunction, setLocalFunction] = useState(conditionFunction);
  const [conditionsExpanded, setConditionsExpanded] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const conditionRefs = useRef<(HTMLInputElement | null)[]>([]);
  const initialFunctionRef = useRef(conditionFunction);
  const [saveCounter, setSaveCounter] = useState(0);

  // Sync local state when prop changes
  React.useEffect(() => {
    setLocalFunction(conditionFunction);
    initialFunctionRef.current = conditionFunction;
  }, [conditionFunction]);

  const isDirty = useMemo(() => {
    return JSON.stringify(initialFunctionRef.current) !== JSON.stringify(localFunction);
  }, [localFunction, saveCounter]);

  const handleSave = useCallback(async () => {
    // Apply changes to semantic model (which will trigger file save in parent)
    onUpdateFunction(localFunction);
    // Mark this as the new "clean" state
    initialFunctionRef.current = localFunction;
    // Force isDirty recalculation
    setSaveCounter(c => c + 1);
  }, [localFunction, onUpdateFunction]);

  const handleReset = useCallback(() => {
    setLocalFunction(conditionFunction);
  }, [conditionFunction]);

  const updateCondition = useCallback((index: number, updated: any) => {
    if (!localFunction) return;
    const newConditions = [...(localFunction.conditions || [])];
    newConditions[index] = updated;
    setLocalFunction({
      ...localFunction,
      conditions: newConditions
    });
  }, [localFunction]);

  const deleteCondition = useCallback((index: number) => {
    if (!localFunction) return;
    const newConditions = (localFunction.conditions || []).filter((_: any, i: number) => i !== index);
    setLocalFunction({
      ...localFunction,
      conditions: newConditions
    });
  }, [localFunction]);

  const focusCondition = useCallback((index: number) => {
    setTimeout(() => {
      conditionRefs.current[index]?.focus();
    }, 10);
  }, []);

  const addCondition = useCallback((conditionType: 'npcKnowsInfo' | 'variable' | 'generic') => {
    if (!localFunction) return;

    let newCondition: any;
    switch (conditionType) {
      case 'npcKnowsInfo':
        newCondition = {
          npc: 'self',
          dialogRef: '',
          getTypeName: () => 'NpcKnowsInfoCondition'
        };
        break;
      case 'variable':
        newCondition = {
          variableName: '',
          negated: false,
          getTypeName: () => 'VariableCondition'
        };
        break;
      case 'generic':
        newCondition = {
          condition: '',
          getTypeName: () => 'Condition'
        };
        break;
    }

    const newConditions = [...(localFunction.conditions || []), newCondition];
    setLocalFunction({
      ...localFunction,
      conditions: newConditions
    });

    // Focus the new condition
    setTimeout(() => {
      const newIndex = newConditions.length - 1;
      conditionRefs.current[newIndex]?.focus();
    }, 10);
  }, [localFunction]);

  const getConditionType = (condition: any): string => {
    if (typeof condition.getTypeName === 'function') {
      return condition.getTypeName();
    }
    if (condition.npc && condition.dialogRef !== undefined) {
      return 'NpcKnowsInfoCondition';
    }
    if (condition.variableName !== undefined) {
      return 'VariableCondition';
    }
    return 'Condition';
  };

  if (!localFunction) {
    return (
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No condition function defined
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          mb: conditionsExpanded ? 2 : 0
        }}
        onClick={() => setConditionsExpanded(!conditionsExpanded)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6">Conditions</Typography>
          {localFunction.name && (
            <Chip
              label={localFunction.name}
              size="small"
              variant="outlined"
              sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
            />
          )}
          {!conditionsExpanded && (
            <Chip
              label={`${(localFunction.conditions || []).length} condition${(localFunction.conditions || []).length !== 1 ? 's' : ''}`}
              size="small"
              color="default"
              sx={{ fontSize: '0.75rem' }}
            />
          )}
          {isDirty && <Chip label="Unsaved" size="small" color="warning" />}
        </Box>
        <IconButton size="small">
          {conditionsExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
        </IconButton>
      </Box>

      {conditionsExpanded && (
        <>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {(localFunction.conditions || []).length} condition(s) - ALL must be true
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                size="small"
                disabled={!isDirty}
                onClick={(e) => {
                  e.stopPropagation();
                  handleReset();
                }}
              >
                Reset
              </Button>
              <Button
                variant="contained"
                color="success"
                size="small"
                disabled={!isDirty}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSave();
                }}
              >
                Save
              </Button>
            </Stack>
          </Box>

          {!localFunction.conditions || localFunction.conditions.length === 0 ? (
            <Box sx={{
              p: 3,
              border: '2px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              textAlign: 'center',
              bgcolor: 'action.hover'
            }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                No conditions - dialog is always available
              </Typography>
              <Button
                startIcon={<AddIcon />}
                size="small"
                variant="outlined"
                onClick={(e) => setAddMenuAnchor(e.currentTarget)}
              >
                Add Condition
              </Button>
            </Box>
          ) : (
            <>
              <Stack spacing={2}>
                {localFunction.conditions.map((condition: any, idx: number) => (
                  <ConditionCard
                    key={idx}
                    ref={(el) => (conditionRefs.current[idx] = el)}
                    condition={condition}
                    index={idx}
                    totalConditions={localFunction.conditions.length}
                    updateCondition={updateCondition}
                    deleteCondition={deleteCondition}
                    focusCondition={focusCondition}
                    semanticModel={semanticModel}
                  />
                ))}
              </Stack>
              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                <Button
                  startIcon={<AddIcon />}
                  size="small"
                  variant="outlined"
                  onClick={(e) => setAddMenuAnchor(e.currentTarget)}
                >
                  Add Condition
                </Button>
              </Box>
            </>
          )}

          <Menu
            anchorEl={addMenuAnchor}
            open={Boolean(addMenuAnchor)}
            onClose={() => setAddMenuAnchor(null)}
          >
            <MenuItem onClick={() => { addCondition('npcKnowsInfo'); setAddMenuAnchor(null); }}>
              <InfoIcon fontSize="small" sx={{ mr: 1 }} />
              NPC Knows Dialog
            </MenuItem>
            <MenuItem onClick={() => { addCondition('variable'); setAddMenuAnchor(null); }}>
              <CheckIcon fontSize="small" sx={{ mr: 1 }} />
              Variable Check
            </MenuItem>
            <MenuItem onClick={() => { addCondition('generic'); setAddMenuAnchor(null); }}>
              <CodeIcon fontSize="small" sx={{ mr: 1 }} />
              Custom Condition
            </MenuItem>
          </Menu>
        </>
      )}
    </Paper>
  );
};

export default ConditionEditor;
