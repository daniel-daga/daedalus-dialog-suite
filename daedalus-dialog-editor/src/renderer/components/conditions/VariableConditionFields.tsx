import React from 'react';
import { Box, FormControlLabel, Switch } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type C = {
  type: 'VariableCondition';
  variableName: string;
  negated?: boolean;
  operator?: string;
  value?: string | number | boolean;
  getTypeName?: () => string;
};

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const VARIABLE_NAME_FIELD_SX = { flex: 1 };

export default function VariableConditionFields({ condition, handleUpdate, handleImmediateUpdate, flushUpdate, mainFieldRef, semanticModel }: ConditionFieldsProps) {
  const c = condition as unknown as C;
  const upd = React.useCallback(
    (patch: Partial<C>): ConditionEditorCondition => ({ ...c, ...patch } as unknown as ConditionEditorCondition),
    [c]
  );
  const handleVariableNameChange = React.useCallback(
    (value: string) => handleUpdate(upd({ variableName: value })),
    [handleUpdate, upd]
  );
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
      <FormControlLabel
        control={
          <Switch
            checked={c.negated || false}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleImmediateUpdate(upd({ negated: e.target.checked }))}
            size="small"
          />
        }
        label="NOT"
        sx={{ mr: 1 }}
      />
      <VariableAutocomplete
        label="Variable Name"
        value={c.variableName || ''}
        onChange={handleVariableNameChange}
        onFlush={flushUpdate}
        {...AUTOCOMPLETE_POLICIES.conditions.variableName}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={VARIABLE_NAME_FIELD_SX}
        placeholder="e.g., MIS_QuestCompleted"
        semanticModel={semanticModel}
      />
    </Box>
  );
}
