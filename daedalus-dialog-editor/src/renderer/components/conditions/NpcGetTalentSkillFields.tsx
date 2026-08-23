import React from 'react';
import { Box, TextField } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type C = {
  type: 'NpcGetTalentSkillCondition';
  npc: string;
  talent: string;
  operator?: string;
  value?: string | number | boolean;
  getTypeName?: () => string;
};

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const NPC_FIELD_SX = { flex: '1 1 25%', minWidth: 120 };

export default function NpcGetTalentSkillFields({ condition, handleUpdate, flushUpdate, mainFieldRef }: ConditionFieldsProps) {
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
      <TextField
        label="Talent"
        value={c.talent || ''}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleUpdate(upd({ talent: e.target.value }))}
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
