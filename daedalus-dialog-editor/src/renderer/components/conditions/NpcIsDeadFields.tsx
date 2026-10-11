import React from 'react';
import { Box, FormControlLabel, Switch } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type C = { type: 'NpcIsDeadCondition'; npc: string; negated?: boolean; getTypeName?: () => string };

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const NPC_FIELD_SX = { flex: 1 };

export default function NpcIsDeadFields({ condition, handleUpdate, handleImmediateUpdate, flushUpdate, mainFieldRef }: ConditionFieldsProps) {
  const c = condition as unknown as C;
  const upd = React.useCallback(
    (patch: Partial<C>): ConditionEditorCondition => ({ ...c, ...patch } as unknown as ConditionEditorCondition),
    [c]
  );
  const handleNpcChange = React.useCallback(
    (value: string) => handleUpdate(upd({ npc: value })),
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
        label="NPC"
        value={c.npc || ''}
        onChange={handleNpcChange}
        onFlush={flushUpdate}
        {...AUTOCOMPLETE_POLICIES.conditions.npc}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={NPC_FIELD_SX}
      />
    </Box>
  );
}
