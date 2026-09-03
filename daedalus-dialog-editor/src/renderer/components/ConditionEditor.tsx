import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Box, Paper, Typography, Stack, IconButton, Tooltip, Button, Menu, MenuItem, Chip } from '@mui/material';
import { Add as AddIcon, ExpandMore as ExpandMoreIcon, ChevronRight as ChevronRightIcon } from '@mui/icons-material';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import ConditionCard from './ConditionCard';
import { CONDITION_REGISTRY } from './conditions/conditionRegistry';
import type { DialogCondition, DialogFunction } from '../types/global';
import type { ConditionEditorCondition, FunctionUpdater } from './dialogTypes';

// Memo-boundary invariant (docs/architecture/render-performance.md): model
// data must not cross this boundary. ConditionEditor deliberately takes no
// `semanticModel` prop — the condition fields' autocomplete leaves read model
// data through `useVariableOptions`' own per-category store subscriptions, so
// merged/file-model identity churn never re-renders the condition subtree.
interface ConditionEditorProps {
  conditionFunction: DialogFunction;
  onUpdateFunction: (funcOrUpdater: FunctionUpdater) => void;
  filePath: string | null;
  dialogName: string;
}

const ConditionEditor = React.memo<ConditionEditorProps>(({
  conditionFunction,
  onUpdateFunction,
  filePath: _filePath,
  dialogName
}) => {
  const [conditionsExpanded, setConditionsExpanded] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  // The editor pane stays mounted across dialog switches (render-performance.md
  // "Editor stays mounted across dialog switches"), so per-dialog UI state is
  // reset explicitly — same idiom as `propertiesExpanded` in DialogDetailsEditor.
  useEffect(() => {
    setConditionsExpanded(false);
  }, [dialogName]);
  const conditionRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Stable synthetic identities for ConditionCard keys (fix-05 §2.4 stage 2).
  // Conditions carry no id, so a parallel uiIds side-table gives each card a
  // key that survives a deletion above it — keeping the card owning a pending
  // debounce mounted so the in-flight edit lands on the right condition. The
  // handlers below splice/push uiIds in lockstep with the conditions array;
  // out-of-band length changes (undo/redo, dialog switch) regenerate the ids.
  const uiIdsRef = useRef<string[]>([]);
  const uiIdCounterRef = useRef(0);
  const uiIdsNameRef = useRef<string | undefined>(undefined);
  const currentConditionCount = conditionFunction?.conditions?.length ?? 0;
  if (
    uiIdsNameRef.current !== conditionFunction?.name ||
    uiIdsRef.current.length !== currentConditionCount
  ) {
    uiIdsNameRef.current = conditionFunction?.name;
    uiIdsRef.current = Array.from(
      { length: currentConditionCount },
      () => `cond-${uiIdCounterRef.current++}`
    );
  }
  const isNpcKnowsCondition = (condition: ConditionEditorCondition): condition is ConditionEditorCondition & { npc: string; dialogRef: string } =>
    'npc' in condition && 'dialogRef' in condition;
  const isVariableCondition = (condition: ConditionEditorCondition): condition is ConditionEditorCondition & { variableName: string } =>
    'variableName' in condition;

  // Helper to strip non-serializable functions from conditions
  const sanitizeCondition = (condition: ConditionEditorCondition): DialogCondition => {
    const { getTypeName: _getTypeName, ...rest } = condition;
    return rest as DialogCondition;
  };

  // Cache hydrated conditions by their raw (store) object so an unchanged
  // condition keeps a STABLE hydrated reference across re-renders (fix-05 §2.4
  // stage 2). Without this, hydrating fresh objects every render makes each
  // ConditionCard's prop-sync effect fire on any sibling edit — clobbering a
  // pending debounce in a card that was not touched. Immer structural sharing
  // keeps unchanged conditions reference-stable, so a WeakMap keys cleanly.
  const hydrationCacheRef = useRef(new WeakMap<object, ConditionEditorCondition>());

  // Helper to add getTypeName to conditions for UI usage
  const hydrateCondition = (condition: ConditionEditorCondition): ConditionEditorCondition => {
    // If already has getTypeName, return as-is
    if (typeof condition.getTypeName === 'function') {
      return condition;
    }

    const cached = hydrationCacheRef.current.get(condition as object);
    if (cached) return cached;

    let hydrated: ConditionEditorCondition;
    if (condition.type) {
      hydrated = { ...condition, getTypeName: () => condition.type as string };
    } else if (isNpcKnowsCondition(condition)) {
      hydrated = { ...condition, getTypeName: () => 'NpcKnowsInfoCondition' };
    } else if (isVariableCondition(condition)) {
      hydrated = { ...condition, getTypeName: () => 'VariableCondition' };
    } else {
      hydrated = { ...condition, getTypeName: () => 'Condition' };
    }
    hydrationCacheRef.current.set(condition as object, hydrated);
    return hydrated;
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
      // Only overwrite an in-range slot. An out-of-range index means the card
      // was reindexed/removed while a debounce was pending (finding U3): the
      // write is a no-op rather than appending a resurrected condition.
      if (index >= 0 && index < newConditions.length) {
        newConditions[index] = sanitizeCondition(updated);
      }
      return {
        ...currentFunc,
        conditions: newConditions
      };
    });
  }, [onUpdateFunction]);

  const deleteCondition = useCallback((index: number) => {
    // Keep the uiIds side-table in lockstep so surviving cards keep their keys.
    if (index >= 0 && index < uiIdsRef.current.length) {
      uiIdsRef.current = uiIdsRef.current.filter((_, i) => i !== index);
    }
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

  const addCondition = useCallback((conditionType: string) => {
    const newCondition = CONDITION_REGISTRY[conditionType].createDefault();

    // Append a matching uiId so the reconcile above does not regenerate keys.
    uiIdsRef.current = [...uiIdsRef.current, `cond-${uiIdCounterRef.current++}`];
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
          <IconButton
            size="small"
            aria-label={conditionsExpanded ? 'Collapse conditions' : 'Expand conditions'}
            aria-expanded={conditionsExpanded}
          >
            {conditionsExpanded ? <ExpandMoreIcon /> : <ChevronRightIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      {conditionsExpanded && (
        <>
          <Box sx={{ mb: 2 }}>
            {(localFunction.conditions || []).length > 0 ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                  {(localFunction.conditions || []).length} condition(s) -{' '}
                  {(localFunction.conditionOperator ?? 'AND') === 'OR' ? 'ANY must be true' : 'ALL must be true'}
                </Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={localFunction.conditionOperator ?? 'AND'}
                  onChange={(_e, val) => {
                    if (val === null) return;
                    onUpdateFunction((f) => f ? { ...f, conditionOperator: val as 'AND' | 'OR' } : f);
                  }}
                  aria-label="condition operator"
                  sx={{ ml: 1 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ToggleButton value="AND" sx={{ py: 0, px: 1, fontSize: '0.65rem', lineHeight: 1.5 }}>AND</ToggleButton>
                  <ToggleButton value="OR" sx={{ py: 0, px: 1, fontSize: '0.65rem', lineHeight: 1.5 }}>OR</ToggleButton>
                </ToggleButtonGroup>
              </Box>
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
                    key={uiIdsRef.current[idx] ?? idx}
                    ref={(el) => (conditionRefs.current[idx] = el)}
                    condition={condition}
                    index={idx}
                    totalConditions={localFunction.conditions.length}
                    operator={localFunction.conditionOperator ?? 'AND'}
                    updateCondition={updateCondition}
                    deleteCondition={deleteCondition}
                    focusCondition={focusCondition}
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
            {Object.entries(CONDITION_REGISTRY).map(([conditionType, entry]) => (
              <MenuItem key={conditionType} onClick={() => { addCondition(conditionType); setAddMenuAnchor(null); }}>
                {React.cloneElement(entry.icon, { sx: { mr: 1 } })}
                {entry.menuLabel}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Paper>
  );
});

export default ConditionEditor;
