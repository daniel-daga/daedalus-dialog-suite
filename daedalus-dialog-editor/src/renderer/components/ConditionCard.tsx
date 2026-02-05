import React, { useState, useRef, useCallback } from 'react';
import { Box, TextField, IconButton, Tooltip, Chip, Typography, Switch, FormControlLabel } from '@mui/material';
import { Delete as DeleteIcon, Info as InfoIcon, Code as CodeIcon, Check as CheckIcon } from '@mui/icons-material';
import VariableAutocomplete from './common/VariableAutocomplete';
import type { SemanticModel } from '../../shared/types';

interface ConditionCardProps {
  condition: any;
  index: number;
  totalConditions: number;
  updateCondition: (index: number, updated: any) => void;
  deleteCondition: (index: number) => void;
  focusCondition: (index: number) => void;
  semanticModel?: SemanticModel;
}

const ConditionCard = React.memo(React.forwardRef<HTMLInputElement, ConditionCardProps>(({
  condition,
  index,
  totalConditions,
  updateCondition,
  deleteCondition,
  focusCondition: _focusCondition,
  semanticModel
}, ref) => {
  const mainFieldRef = useRef<HTMLInputElement>(null);
  const [localCondition, setLocalCondition] = useState(condition);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Use refs to store latest values without triggering re-renders
  const localConditionRef = useRef(localCondition);
  const indexRef = useRef(index);
  const updateConditionRef = useRef(updateCondition);

  // Keep refs in sync with latest values
  React.useEffect(() => {
    localConditionRef.current = localCondition;
  }, [localCondition]);

  React.useEffect(() => {
    indexRef.current = index;
  }, [index]);

  React.useEffect(() => {
    updateConditionRef.current = updateCondition;
  }, [updateCondition]);

  // Sync local state when condition prop changes from parent
  React.useEffect(() => {
    setLocalCondition(condition);
  }, [condition]);

  // Expose the ref to parent
  React.useImperativeHandle(ref, () => mainFieldRef.current!);

  const flushUpdate = useCallback(() => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    updateCondition(index, localCondition);
  }, [updateCondition, index, localCondition]);

  const handleUpdate = useCallback((updated: any) => {
    setLocalCondition(updated);
    // Debounced update to parent
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }
    updateTimerRef.current = setTimeout(() => {
      updateCondition(index, updated);
    }, 300);
  }, [updateCondition, index]);

  const handleDelete = useCallback(() => {
    deleteCondition(index);
  }, [deleteCondition, index]);

  const getConditionType = (): string => {
    if (typeof localCondition.getTypeName === 'function') {
      return localCondition.getTypeName();
    }
    if (localCondition.npc && localCondition.dialogRef !== undefined) {
      return 'NpcKnowsInfoCondition';
    }
    if (localCondition.variableName !== undefined) {
      return 'VariableCondition';
    }
    return 'Condition';
  };

  const conditionType = getConditionType();

  const getConditionIcon = () => {
    switch (conditionType) {
      case 'NpcKnowsInfoCondition':
        return <InfoIcon fontSize="small" />;
      case 'VariableCondition':
        return <CheckIcon fontSize="small" />;
      case 'Condition':
      default:
        return <CodeIcon fontSize="small" />;
    }
  };

  const getConditionLabel = () => {
    switch (conditionType) {
      case 'NpcKnowsInfoCondition':
        return 'NPC Knows Dialog';
      case 'VariableCondition':
        return localCondition.negated ? 'Variable is False' : 'Variable is True';
      case 'Condition':
      default:
        return 'Custom Condition';
    }
  };

  const renderConditionFields = () => {
    switch (conditionType) {
      case 'NpcKnowsInfoCondition':
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <VariableAutocomplete
              label="NPC"
              value={localCondition.npc || ''}
              onChange={(value) => handleUpdate({ ...localCondition, npc: value })}
              onFlush={flushUpdate}
              showInstances
              typeFilter="C_NPC"
              isMainField
              mainFieldRef={mainFieldRef}
              sx={{ flex: '1 1 30%', minWidth: 120 }}
              semanticModel={semanticModel}
            />
            <Typography sx={{ color: 'text.secondary', fontSize: '0.875rem', flexShrink: 0 }}>
              knows
            </Typography>
            <VariableAutocomplete
              label="Dialog"
              value={localCondition.dialogRef || ''}
              onChange={(value) => handleUpdate({ ...localCondition, dialogRef: value })}
              onFlush={flushUpdate}
              showInstances
              showDialogs
              typeFilter="C_INFO"
              namePrefix="DIA_"
              sx={{ flex: '1 1 60%', minWidth: 150 }}
              semanticModel={semanticModel}
            />
          </Box>
        );

      case 'VariableCondition':
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={localCondition.negated || false}
                  onChange={(e) => {
                    const updated = { ...localCondition, negated: e.target.checked };
                    setLocalCondition(updated);
                    updateCondition(index, updated);
                  }}
                  size="small"
                />
              }
              label="NOT"
              sx={{ mr: 1 }}
            />
            <VariableAutocomplete
              label="Variable Name"
              value={localCondition.variableName || ''}
              onChange={(value) => handleUpdate({ ...localCondition, variableName: value })}
              onFlush={flushUpdate}
              typeFilter={['int', 'string', 'float']}
              namePrefix="MIS_"
              isMainField
              mainFieldRef={mainFieldRef}
              sx={{ flex: 1 }}
              placeholder="e.g., MIS_QuestCompleted"
              semanticModel={semanticModel}
            />
          </Box>
        );

      case 'Condition':
      default:
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <TextField
              label="Condition Expression"
              value={localCondition.condition || ''}
              onChange={(e) => handleUpdate({ ...localCondition, condition: e.target.value })}
              onBlur={flushUpdate}
              size="small"
              inputRef={mainFieldRef}
              sx={{ flex: 1 }}
              placeholder="e.g., hero.attribute[ATR_STRENGTH] >= 50"
              multiline
              maxRows={3}
            />
          </Box>
        );
    }
  };

  // Cleanup timer on unmount - use refs to avoid stale closures
  React.useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        // Flush using refs to get latest values and avoid data loss
        // This ensures we use the current index/condition, not stale values from closure
        updateConditionRef.current(indexRef.current, localConditionRef.current);
      }
    };
  }, []); // Empty deps - cleanup function only created once, uses refs for latest values

  return (
    <Box
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.default',
        '&:hover': {
          borderColor: 'primary.main',
          bgcolor: 'action.hover'
        }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Tooltip title={getConditionLabel()} arrow>
          <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
            {getConditionIcon()}
          </Box>
        </Tooltip>
        <Chip
          label={getConditionLabel()}
          size="small"
          variant="outlined"
          sx={{ fontSize: '0.7rem' }}
        />
        {index < totalConditions - 1 && (
          <Chip
            label="AND"
            size="small"
            color="primary"
            sx={{ fontSize: '0.65rem', height: '20px' }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Delete condition">
          <IconButton
            size="small"
            color="error"
            onClick={handleDelete}
            sx={{ flexShrink: 0 }}
            aria-label="Delete condition"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {renderConditionFields()}
    </Box>
  );
}));

ConditionCard.displayName = 'ConditionCard';

export default ConditionCard;
