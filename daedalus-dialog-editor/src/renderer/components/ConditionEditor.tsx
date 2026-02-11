import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Box, Paper, Typography, Stack, IconButton, Tooltip, Button, Menu, MenuItem, Chip } from '@mui/material';
import { Add as AddIcon, ExpandMore as ExpandMoreIcon, ChevronRight as ChevronRightIcon, Code as CodeIcon, Check as CheckIcon, Info as InfoIcon } from '@mui/icons-material';
import ConditionCard from './ConditionCard';
import type { DialogCondition, DialogFunction, SemanticModel } from '../types/global';
import type { ConditionEditorCondition, FunctionUpdater } from './dialogTypes';

interface ConditionEditorProps {
  conditionFunction: DialogFunction;
  onUpdateFunction: (funcOrUpdater: FunctionUpdater) => void;
  semanticModel?: SemanticModel;
  filePath: string | null;
  dialogName: string;
}

const ConditionEditor = React.memo<ConditionEditorProps>(({
  conditionFunction,
  onUpdateFunction,
  semanticModel,
  filePath: _filePath,
  dialogName: _dialogName
}) => {
  const [conditionsExpanded, setConditionsExpanded] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const conditionRefs = useRef<(HTMLInputElement | null)[]>([]);
  const isNpcKnowsCondition = (condition: ConditionEditorCondition): condition is ConditionEditorCondition & { npc: string; dialogRef: string } =>
    'npc' in condition && 'dialogRef' in condition;
  const isVariableCondition = (condition: ConditionEditorCondition): condition is ConditionEditorCondition & { variableName: string } =>
    'variableName' in condition;

  // Helper to strip non-serializable functions from conditions
  const sanitizeCondition = (condition: ConditionEditorCondition): DialogCondition => {
    const { getTypeName, ...rest } = condition;
    return rest as DialogCondition;
  };

  // Helper to add getTypeName to conditions for UI usage
  const hydrateCondition = (condition: ConditionEditorCondition): ConditionEditorCondition => {
    // If already has getTypeName, return as-is
    if (typeof condition.getTypeName === 'function') {
      return condition;
    }

    // Add getTypeName based on condition properties
    if (isNpcKnowsCondition(condition)) {
      return { ...condition, getTypeName: () => 'NpcKnowsInfoCondition' };
    }
    if (isVariableCondition(condition)) {
      return { ...condition, getTypeName: () => 'VariableCondition' };
    }
    return { ...condition, getTypeName: () => 'Condition' };
  };

  // Hydrate conditions with getTypeName for UI (store doesn't have these functions)
  // Use useMemo to avoid recalculating on every render if conditionFunction hasn't changed
  const localFunction = useMemo(() => {
    if (!conditionFunction) return null;
    return {
      ...conditionFunction,
      conditions: (conditionFunction.conditions || []).map(hydrateCondition),
      actions: conditionFunction.actions || []
    };
  }, [conditionFunction]);

  const rawConditionActions = useMemo(() => {
    if (!localFunction?.actions || localFunction.actions.length === 0) {
      return [];
    }

    return localFunction.actions
      .filter((action): action is { type: 'Action'; action: string } =>
        action.type === 'Action' && typeof action.action === 'string')
      .map((action) => action.action.trim())
      .filter((code: string) => code.length > 0);
  }, [localFunction]);

  const updateCondition = useCallback((index: number, updated: ConditionEditorCondition) => {
    onUpdateFunction((currentFunc) => {
      if (!currentFunc) return currentFunc;
      const newConditions = [...(currentFunc.conditions || [])];
      // Note: we assume index is valid. If array changed concurrently, this might be risky,
      // but it's better than overwriting the whole function.
      if (index >= 0 && index < newConditions.length) {
        newConditions[index] = sanitizeCondition(updated);
      } else if (index === newConditions.length) {
        newConditions.push(sanitizeCondition(updated));
      }
      return {
        ...currentFunc,
        conditions: newConditions
      };
    });
  }, [onUpdateFunction]);

  const deleteCondition = useCallback((index: number) => {
    onUpdateFunction((currentFunc) => {
      if (!currentFunc) return currentFunc;
      const newConditions = (currentFunc.conditions || []).filter((_, i: number) => i !== index);
      return {
        ...currentFunc,
        conditions: newConditions
      };
    });
  }, [onUpdateFunction]);

  const focusCondition = useCallback((index: number) => {
    setTimeout(() => {
      conditionRefs.current[index]?.focus();
    }, 10);
  }, []);

  const addCondition = useCallback((conditionType: 'npcKnowsInfo' | 'variable' | 'generic') => {
    let newCondition: ConditionEditorCondition;
    switch (conditionType) {
      case 'npcKnowsInfo':
        newCondition = {
          type: 'NpcKnowsInfoCondition',
          npc: 'self',
          dialogRef: '',
          getTypeName: () => 'NpcKnowsInfoCondition'
        };
        break;
      case 'variable':
        newCondition = {
          type: 'VariableCondition',
          variableName: '',
          negated: false,
          getTypeName: () => 'VariableCondition'
        };
        break;
      case 'generic':
        newCondition = {
          type: 'Condition',
          condition: '',
          getTypeName: () => 'Condition'
        };
        break;
    }

    onUpdateFunction((currentFunc) => {
      if (!currentFunc) return currentFunc;
      const newConditions = [...(currentFunc.conditions || []), sanitizeCondition(newCondition)];
      return {
        ...currentFunc,
        conditions: newConditions
      };
    });

    // Focus the new condition
    // We use localFunction length as approximation for where it will be
    const estimatedIndex = localFunction?.conditions?.length || 0;
    setTimeout(() => {
      conditionRefs.current[estimatedIndex]?.focus();
    }, 10);
  }, [localFunction, onUpdateFunction]);

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
              label={
                (localFunction.conditions || []).length > 0
                  ? `${(localFunction.conditions || []).length} condition${(localFunction.conditions || []).length !== 1 ? 's' : ''}`
                  : rawConditionActions.length > 0
                    ? `${rawConditionActions.length} raw statement${rawConditionActions.length !== 1 ? 's' : ''}`
                    : '0 conditions'
              }
              size="small"
              color="default"
              sx={{ fontSize: '0.75rem' }}
            />
          )}
        </Box>
        <Tooltip title={conditionsExpanded ? 'Collapse conditions' : 'Expand conditions'}>
          <IconButton size="small" aria-label={conditionsExpanded ? 'Collapse conditions' : 'Expand conditions'}>
            {conditionsExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      {conditionsExpanded && (
        <>
          <Box sx={{ mb: 2 }}>
            {(localFunction.conditions || []).length > 0 ? (
              <Typography variant="caption" color="text.secondary">
                {(localFunction.conditions || []).length} condition(s) - ALL must be true
              </Typography>
            ) : rawConditionActions.length > 0 ? (
              <Typography variant="caption" color="warning.main">
                Raw condition mode: unsupported condition structure is preserved verbatim
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">
                0 condition(s) - dialog is always available
              </Typography>
            )}
          </Box>

          {!localFunction.conditions || localFunction.conditions.length === 0 ? (
            rawConditionActions.length > 0 ? (
              <Stack spacing={1.5}>
                {rawConditionActions.map((code: string, idx: number) => (
                  <Box
                    key={`${idx}-${code.slice(0, 24)}`}
                    sx={{
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                      border: '1px solid',
                      borderColor: 'divider',
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {code}
                  </Box>
                ))}
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                  <Button
                    startIcon={<AddIcon />}
                    size="small"
                    variant="outlined"
                    onClick={(e) => setAddMenuAnchor(e.currentTarget)}
                  >
                    Add Condition
                  </Button>
                </Box>
              </Stack>
            ) : (
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
            )
          ) : (
            <>
              <Stack spacing={2}>
                {localFunction.conditions.map((condition: ConditionEditorCondition, idx: number) => (
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
});

export default ConditionEditor;
