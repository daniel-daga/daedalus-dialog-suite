import React from 'react';
import { Box, TextField } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type C = {
  type: 'NpcHasItemsCondition';
  npc: string;
  item: string;
  operator?: string;
  value?: string | number | boolean;
  getTypeName?: () => string;
};

// Hoisted so VariableAutocomplete's memo sees stable sx identities (slice 4).
const NPC_FIELD_SX = { flex: '1 1 30%', minWidth: 120 };
const ITEM_FIELD_SX = { flex: '1 1 35%', minWidth: 140 };

export default function NpcHasItemsFields({ condition, handleUpdate, flushUpdate, mainFieldRef }: ConditionFieldsProps) {
  const c = condition as unknown as C;
  const upd = React.useCallback(
    (patch: Partial<C>): ConditionEditorCondition => ({ ...c, ...patch } as unknown as ConditionEditorCondition),
    [c]
  );
  const handleNpcChange = React.useCallback(
    (value: string) => handleUpdate(upd({ npc: value })),
    [handleUpdate, upd]
  );
  const handleItemChange = React.useCallback(
    (value: string) => handleUpdate(upd({ item: value })),
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
      <VariableAutocomplete
        label="Item"
        value={c.item || ''}
        onChange={handleItemChange}
        onFlush={flushUpdate}
        {...AUTOCOMPLETE_POLICIES.conditions.item}
        sx={ITEM_FIELD_SX}
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
