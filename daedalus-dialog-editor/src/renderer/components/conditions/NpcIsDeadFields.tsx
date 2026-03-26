import React from 'react';
import { Box, FormControlLabel, Switch } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type C = { type: 'NpcIsDeadCondition'; npc: string; negated?: boolean; getTypeName?: () => string };

export default function NpcIsDeadFields({ condition, handleUpdate, handleImmediateUpdate, flushUpdate, mainFieldRef, semanticModel }: ConditionFieldsProps) {
  const c = condition as unknown as C;
  const upd = (patch: Partial<C>): ConditionEditorCondition => ({ ...c, ...patch } as unknown as ConditionEditorCondition);
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
        onChange={(value: string) => handleUpdate(upd({ npc: value }))}
        onFlush={flushUpdate}
        {...AUTOCOMPLETE_POLICIES.conditions.npc}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ flex: 1 }}
        semanticModel={semanticModel}
      />
    </Box>
  );
}
