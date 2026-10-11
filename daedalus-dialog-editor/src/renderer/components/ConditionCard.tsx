import React, { useRef } from 'react';
import { Box, Chip, IconButton, Tooltip } from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import { useConditionUpdate } from './hooks/useConditionUpdate';
import { CONDITION_REGISTRY, FALLBACK_ENTRY, getConditionType } from './conditions/conditionRegistry';
import type { ConditionEditorCondition } from './dialogTypes';

// Memo-boundary invariant (docs/architecture/render-performance.md): model
// data must not cross this boundary — no `semanticModel` prop. The condition
// fields' autocomplete leaves subscribe to model data themselves.
interface ConditionCardProps {
  condition: ConditionEditorCondition;
  index: number;
  totalConditions: number;
  operator?: 'AND' | 'OR';
  updateCondition: (index: number, updated: ConditionEditorCondition) => void;
  deleteCondition: (index: number) => void;
  focusCondition: (index: number) => void;
}

const ConditionCard = React.memo(React.forwardRef<HTMLInputElement, ConditionCardProps>(({
  condition,
  index,
  totalConditions,
  operator = 'AND',
  updateCondition,
  deleteCondition,
  focusCondition: _focusCondition
}, ref) => {
  const mainFieldRef = useRef<HTMLInputElement>(null);
  const { localCondition, handleUpdate, handleImmediateUpdate, flushUpdate, markDeleted } = useConditionUpdate(
    condition, index, updateCondition
  );

  // Expose the ref to parent
  React.useImperativeHandle(ref, () => mainFieldRef.current!);

  const conditionType = getConditionType(localCondition);
  const entry = CONDITION_REGISTRY[conditionType] ?? FALLBACK_ENTRY;
  const { Fields } = entry;

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
        <Tooltip title={entry.label(localCondition)} arrow>
          <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
            {entry.icon}
          </Box>
        </Tooltip>
        <Chip
          label={entry.label(localCondition)}
          size="small"
          variant="outlined"
          sx={{ fontSize: '0.7rem' }}
        />
        {index < totalConditions - 1 && (
          <Chip
            label={operator}
            size="small"
            color={operator === 'OR' ? 'secondary' : 'primary'}
            sx={{ fontSize: '0.65rem', height: '20px' }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Delete condition">
          <IconButton
            size="small"
            color="error"
            onClick={() => { markDeleted(); deleteCondition(index); }}
            sx={{ flexShrink: 0 }}
            aria-label="Delete condition"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Fields
        condition={localCondition}
        handleUpdate={handleUpdate}
        handleImmediateUpdate={handleImmediateUpdate}
        flushUpdate={flushUpdate}
        mainFieldRef={mainFieldRef}
      />
    </Box>
  );
}));

ConditionCard.displayName = 'ConditionCard';

export default ConditionCard;
