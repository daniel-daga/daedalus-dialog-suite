import React, { useState, useRef, useCallback } from 'react';
import { Box, TextField, IconButton, Tooltip, Chip, Typography, Switch, FormControlLabel } from '@mui/material';
import { Delete as DeleteIcon, Info as InfoIcon, Code as CodeIcon, Check as CheckIcon } from '@mui/icons-material';
import VariableAutocomplete from './common/VariableAutocomplete';
import type { SemanticModel } from '../types/global';
import type { ConditionEditorCondition } from './dialogTypes';

interface ConditionCardProps {
  condition: ConditionEditorCondition;
  index: number;
  totalConditions: number;
  updateCondition: (index: number, updated: ConditionEditorCondition) => void;
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
  const isNpcKnowsCondition = (current: ConditionEditorCondition): current is ConditionEditorCondition & { npc: string; dialogRef: string } =>
    'npc' in current && 'dialogRef' in current;
  const isVariableCondition = (current: ConditionEditorCondition): current is ConditionEditorCondition & {
    variableName: string;
    negated?: boolean;
    operator?: string;
    value?: string | number | boolean;
  } =>
    'variableName' in current;
  const isExpressionCondition = (current: ConditionEditorCondition): current is ConditionEditorCondition & { condition: string } =>
    'condition' in current;
  const isNpcHasItemsCondition = (current: ConditionEditorCondition): current is ConditionEditorCondition & {
    npc: string;
    item: string;
    operator?: string;
    value?: string | number | boolean;
  } => current.type === 'NpcHasItemsCondition';
  const isNpcIsInStateCondition = (current: ConditionEditorCondition): current is ConditionEditorCondition & {
    npc: string;
    state: string;
    negated?: boolean;
  } => current.type === 'NpcIsInStateCondition';
  const isNpcIsDeadCondition = (current: ConditionEditorCondition): current is ConditionEditorCondition & {
    npc: string;
    negated?: boolean;
  } => current.type === 'NpcIsDeadCondition';
  const isNpcGetDistToWpCondition = (current: ConditionEditorCondition): current is ConditionEditorCondition & {
    npc: string;
    waypoint: string;
    operator?: string;
    value?: string | number | boolean;
  } => current.type === 'NpcGetDistToWpCondition';
  const isNpcGetTalentSkillCondition = (current: ConditionEditorCondition): current is ConditionEditorCondition & {
    npc: string;
    talent: string;
    operator?: string;
    value?: string | number | boolean;
  } => current.type === 'NpcGetTalentSkillCondition';

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

  const handleUpdate = useCallback((updated: ConditionEditorCondition) => {
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
    if (isNpcKnowsCondition(localCondition) && localCondition.npc) {
      return 'NpcKnowsInfoCondition';
    }
    if (isVariableCondition(localCondition)) {
      return 'VariableCondition';
    }
    if (isNpcHasItemsCondition(localCondition)) {
      return 'NpcHasItemsCondition';
    }
    if (isNpcIsInStateCondition(localCondition)) {
      return 'NpcIsInStateCondition';
    }
    if (isNpcIsDeadCondition(localCondition)) {
      return 'NpcIsDeadCondition';
    }
    if (isNpcGetDistToWpCondition(localCondition)) {
      return 'NpcGetDistToWpCondition';
    }
    if (isNpcGetTalentSkillCondition(localCondition)) {
      return 'NpcGetTalentSkillCondition';
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
      case 'NpcHasItemsCondition':
        return <InfoIcon fontSize="small" />;
      case 'NpcIsInStateCondition':
        return <InfoIcon fontSize="small" />;
      case 'NpcIsDeadCondition':
        return <InfoIcon fontSize="small" />;
      case 'NpcGetDistToWpCondition':
        return <InfoIcon fontSize="small" />;
      case 'NpcGetTalentSkillCondition':
        return <InfoIcon fontSize="small" />;
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
        return isVariableCondition(localCondition) && localCondition.negated ? 'Variable is False' : 'Variable is True';
      case 'NpcHasItemsCondition':
        return 'NPC Has Items';
      case 'NpcIsInStateCondition':
        return isNpcIsInStateCondition(localCondition) && localCondition.negated ? 'NPC Not In State' : 'NPC Is In State';
      case 'NpcIsDeadCondition':
        return isNpcIsDeadCondition(localCondition) && localCondition.negated ? 'NPC Is Alive' : 'NPC Is Dead';
      case 'NpcGetDistToWpCondition':
        return 'Distance To Waypoint';
      case 'NpcGetTalentSkillCondition':
        return 'NPC Talent Skill';
      case 'Condition':
      default:
        return 'Custom Condition';
    }
  };

  const renderConditionFields = () => {
    switch (conditionType) {
      case 'NpcKnowsInfoCondition':
        if (!isNpcKnowsCondition(localCondition)) {
          return null;
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <VariableAutocomplete
              label="NPC"
              value={localCondition.npc || ''}
              onChange={(value) => handleUpdate({
                type: 'NpcKnowsInfoCondition',
                npc: value,
                dialogRef: localCondition.dialogRef,
                getTypeName: localCondition.getTypeName
              })}
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
              onChange={(value) => handleUpdate({
                type: 'NpcKnowsInfoCondition',
                npc: localCondition.npc,
                dialogRef: value,
                getTypeName: localCondition.getTypeName
              })}
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
        if (!isVariableCondition(localCondition)) {
          return null;
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={localCondition.negated || false}
                  onChange={(e) => {
                    const updated: ConditionEditorCondition = {
                      type: 'VariableCondition',
                      variableName: localCondition.variableName,
                      negated: e.target.checked,
                      operator: localCondition.operator,
                      value: localCondition.value,
                      getTypeName: localCondition.getTypeName
                    };
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
              onChange={(value) => handleUpdate({
                type: 'VariableCondition',
                variableName: value,
                negated: localCondition.negated || false,
                operator: localCondition.operator,
                value: localCondition.value,
                getTypeName: localCondition.getTypeName
              })}
              onFlush={flushUpdate}
              typeFilter={['int', 'string', 'float']}
              isMainField
              mainFieldRef={mainFieldRef}
              sx={{ flex: 1 }}
              placeholder="e.g., MIS_QuestCompleted"
              semanticModel={semanticModel}
            />
          </Box>
        );

      case 'NpcHasItemsCondition':
        if (!isNpcHasItemsCondition(localCondition)) {
          return null;
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <VariableAutocomplete
              label="NPC"
              value={localCondition.npc || ''}
              onChange={(value) => handleUpdate({
                type: 'NpcHasItemsCondition',
                npc: value,
                item: localCondition.item,
                operator: localCondition.operator,
                value: localCondition.value,
                getTypeName: localCondition.getTypeName
              })}
              onFlush={flushUpdate}
              showInstances
              typeFilter="C_NPC"
              isMainField
              mainFieldRef={mainFieldRef}
              sx={{ flex: '1 1 30%', minWidth: 120 }}
              semanticModel={semanticModel}
            />
            <VariableAutocomplete
              label="Item"
              value={localCondition.item || ''}
              onChange={(value) => handleUpdate({
                type: 'NpcHasItemsCondition',
                npc: localCondition.npc,
                item: value,
                operator: localCondition.operator,
                value: localCondition.value,
                getTypeName: localCondition.getTypeName
              })}
              onFlush={flushUpdate}
              showInstances
              sx={{ flex: '1 1 35%', minWidth: 140 }}
              semanticModel={semanticModel}
            />
            <TextField
              label="Op"
              value={localCondition.operator || ''}
              onChange={(e) => handleUpdate({
                type: 'NpcHasItemsCondition',
                npc: localCondition.npc,
                item: localCondition.item,
                operator: e.target.value,
                value: localCondition.value,
                getTypeName: localCondition.getTypeName
              })}
              onBlur={flushUpdate}
              size="small"
              sx={{ width: 80 }}
            />
            <TextField
              label="Value"
              value={localCondition.value === undefined ? '' : String(localCondition.value)}
              onChange={(e) => handleUpdate({
                type: 'NpcHasItemsCondition',
                npc: localCondition.npc,
                item: localCondition.item,
                operator: localCondition.operator,
                value: e.target.value,
                getTypeName: localCondition.getTypeName
              })}
              onBlur={flushUpdate}
              size="small"
              sx={{ width: 110 }}
            />
          </Box>
        );

      case 'NpcIsInStateCondition':
        if (!isNpcIsInStateCondition(localCondition)) {
          return null;
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={localCondition.negated || false}
                  onChange={(e) => {
                    const updated: ConditionEditorCondition = {
                      type: 'NpcIsInStateCondition',
                      npc: localCondition.npc,
                      state: localCondition.state,
                      negated: e.target.checked,
                      getTypeName: localCondition.getTypeName
                    };
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
              label="NPC"
              value={localCondition.npc || ''}
              onChange={(value) => handleUpdate({
                type: 'NpcIsInStateCondition',
                npc: value,
                state: localCondition.state,
                negated: localCondition.negated || false,
                getTypeName: localCondition.getTypeName
              })}
              onFlush={flushUpdate}
              showInstances
              typeFilter="C_NPC"
              isMainField
              mainFieldRef={mainFieldRef}
              sx={{ flex: '1 1 35%', minWidth: 130 }}
              semanticModel={semanticModel}
            />
            <TextField
              label="State"
              value={localCondition.state || ''}
              onChange={(e) => handleUpdate({
                type: 'NpcIsInStateCondition',
                npc: localCondition.npc,
                state: e.target.value,
                negated: localCondition.negated || false,
                getTypeName: localCondition.getTypeName
              })}
              onBlur={flushUpdate}
              size="small"
              sx={{ flex: '1 1 45%', minWidth: 150 }}
            />
          </Box>
        );

      case 'NpcIsDeadCondition':
        if (!isNpcIsDeadCondition(localCondition)) {
          return null;
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={localCondition.negated || false}
                  onChange={(e) => {
                    const updated: ConditionEditorCondition = {
                      type: 'NpcIsDeadCondition',
                      npc: localCondition.npc,
                      negated: e.target.checked,
                      getTypeName: localCondition.getTypeName
                    };
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
              label="NPC"
              value={localCondition.npc || ''}
              onChange={(value) => handleUpdate({
                type: 'NpcIsDeadCondition',
                npc: value,
                negated: localCondition.negated || false,
                getTypeName: localCondition.getTypeName
              })}
              onFlush={flushUpdate}
              showInstances
              typeFilter="C_NPC"
              isMainField
              mainFieldRef={mainFieldRef}
              sx={{ flex: 1 }}
              semanticModel={semanticModel}
            />
          </Box>
        );

      case 'NpcGetDistToWpCondition':
        if (!isNpcGetDistToWpCondition(localCondition)) {
          return null;
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <VariableAutocomplete
              label="NPC"
              value={localCondition.npc || ''}
              onChange={(value) => handleUpdate({
                type: 'NpcGetDistToWpCondition',
                npc: value,
                waypoint: localCondition.waypoint,
                operator: localCondition.operator,
                value: localCondition.value,
                getTypeName: localCondition.getTypeName
              })}
              onFlush={flushUpdate}
              showInstances
              typeFilter="C_NPC"
              isMainField
              mainFieldRef={mainFieldRef}
              sx={{ flex: '1 1 25%', minWidth: 120 }}
              semanticModel={semanticModel}
            />
            <TextField
              label="Waypoint"
              value={localCondition.waypoint || ''}
              onChange={(e) => handleUpdate({
                type: 'NpcGetDistToWpCondition',
                npc: localCondition.npc,
                waypoint: e.target.value,
                operator: localCondition.operator,
                value: localCondition.value,
                getTypeName: localCondition.getTypeName
              })}
              onBlur={flushUpdate}
              size="small"
              sx={{ flex: '1 1 35%', minWidth: 150 }}
            />
            <TextField
              label="Op"
              value={localCondition.operator || ''}
              onChange={(e) => handleUpdate({
                type: 'NpcGetDistToWpCondition',
                npc: localCondition.npc,
                waypoint: localCondition.waypoint,
                operator: e.target.value,
                value: localCondition.value,
                getTypeName: localCondition.getTypeName
              })}
              onBlur={flushUpdate}
              size="small"
              sx={{ width: 80 }}
            />
            <TextField
              label="Value"
              value={localCondition.value === undefined ? '' : String(localCondition.value)}
              onChange={(e) => handleUpdate({
                type: 'NpcGetDistToWpCondition',
                npc: localCondition.npc,
                waypoint: localCondition.waypoint,
                operator: localCondition.operator,
                value: e.target.value,
                getTypeName: localCondition.getTypeName
              })}
              onBlur={flushUpdate}
              size="small"
              sx={{ width: 110 }}
            />
          </Box>
        );

      case 'NpcGetTalentSkillCondition':
        if (!isNpcGetTalentSkillCondition(localCondition)) {
          return null;
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <VariableAutocomplete
              label="NPC"
              value={localCondition.npc || ''}
              onChange={(value) => handleUpdate({
                type: 'NpcGetTalentSkillCondition',
                npc: value,
                talent: localCondition.talent,
                operator: localCondition.operator,
                value: localCondition.value,
                getTypeName: localCondition.getTypeName
              })}
              onFlush={flushUpdate}
              showInstances
              typeFilter="C_NPC"
              isMainField
              mainFieldRef={mainFieldRef}
              sx={{ flex: '1 1 25%', minWidth: 120 }}
              semanticModel={semanticModel}
            />
            <TextField
              label="Talent"
              value={localCondition.talent || ''}
              onChange={(e) => handleUpdate({
                type: 'NpcGetTalentSkillCondition',
                npc: localCondition.npc,
                talent: e.target.value,
                operator: localCondition.operator,
                value: localCondition.value,
                getTypeName: localCondition.getTypeName
              })}
              onBlur={flushUpdate}
              size="small"
              sx={{ flex: '1 1 35%', minWidth: 150 }}
            />
            <TextField
              label="Op"
              value={localCondition.operator || ''}
              onChange={(e) => handleUpdate({
                type: 'NpcGetTalentSkillCondition',
                npc: localCondition.npc,
                talent: localCondition.talent,
                operator: e.target.value,
                value: localCondition.value,
                getTypeName: localCondition.getTypeName
              })}
              onBlur={flushUpdate}
              size="small"
              sx={{ width: 80 }}
            />
            <TextField
              label="Value"
              value={localCondition.value === undefined ? '' : String(localCondition.value)}
              onChange={(e) => handleUpdate({
                type: 'NpcGetTalentSkillCondition',
                npc: localCondition.npc,
                talent: localCondition.talent,
                operator: localCondition.operator,
                value: e.target.value,
                getTypeName: localCondition.getTypeName
              })}
              onBlur={flushUpdate}
              size="small"
              sx={{ width: 110 }}
            />
          </Box>
        );

      case 'Condition':
      default:
        if (!isExpressionCondition(localCondition)) {
          return null;
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <TextField
              label="Condition Expression"
              value={localCondition.condition || ''}
              onChange={(e) => handleUpdate({
                type: 'Condition',
                condition: e.target.value,
                getTypeName: localCondition.getTypeName
              })}
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
