import React from 'react';
import { Box, TextField } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type C = {
  type: 'NpcGetDistToWpCondition';
  npc: string;
  waypoint: string;
  operator?: string;
  value?: string | number | boolean;
  getTypeName?: () => string;
};

export default function NpcGetDistToWpFields({ condition, handleUpdate, flushUpdate, mainFieldRef, semanticModel }: ConditionFieldsProps) {
  const c = condition as unknown as C;
  const upd = (patch: Partial<C>): ConditionEditorCondition => ({ ...c, ...patch } as unknown as ConditionEditorCondition);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
      <VariableAutocomplete
        label="NPC"
        value={c.npc || ''}
        onChange={(value: string) => handleUpdate(upd({ npc: value }))}
        onFlush={flushUpdate}
        {...AUTOCOMPLETE_POLICIES.conditions.npc}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ flex: '1 1 25%', minWidth: 120 }}
        semanticModel={semanticModel}
      />
      <TextField
        label="Waypoint"
        value={c.waypoint || ''}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleUpdate(upd({ waypoint: e.target.value }))}
        onBlur={flushUpdate}
        size="small"
        sx={{ flex: '1 1 35%', minWidth: 150 }}
      />
      <TextField
        label="Op"
        value={c.operator || ''}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleUpdate(upd({ operator: e.target.value }))}
        onBlur={flushUpdate}
        size="small"
        sx={{ width: 80 }}
      />
      <TextField
        label="Value"
        value={c.value === undefined ? '' : String(c.value)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleUpdate(upd({ value: e.target.value }))}
        onBlur={flushUpdate}
        size="small"
        sx={{ width: 110 }}
      />
    </Box>
  );
}
