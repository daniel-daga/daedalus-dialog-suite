import { useCallback } from 'react';
import { Box, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type QuestState = 'LOG_RUNNING' | 'LOG_SUCCESS' | 'LOG_FAILED' | 'LOG_OBSOLETE';
type C = { type: 'QuestStateCondition'; questVariable: string; state: QuestState; getTypeName?: () => string };

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const QUEST_VARIABLE_FIELD_SX = { flex: '1 1 55%', minWidth: 180 };

export default function QuestStateFields({ condition, handleUpdate, handleImmediateUpdate, flushUpdate, mainFieldRef }: ConditionFieldsProps) {
  const c = condition as unknown as C;
  const upd = useCallback(
    (patch: Partial<C>): ConditionEditorCondition => ({ ...c, ...patch } as unknown as ConditionEditorCondition),
    [c]
  );
  const handleQuestVariableChange = useCallback(
    (value: string) => handleUpdate(upd({ questVariable: value })),
    [handleUpdate, upd]
  );
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
      <VariableAutocomplete
        label="Quest-Variable"
        value={c.questVariable || ''}
        onChange={handleQuestVariableChange}
        onFlush={flushUpdate}
        {...AUTOCOMPLETE_POLICIES.conditions.questVariable}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={QUEST_VARIABLE_FIELD_SX}
        placeholder="e.g. MIS_Addon_Greg_ClearCanyon"
      />
      <FormControl size="small" sx={{ flex: '1 1 35%', minWidth: 140 }}>
        <InputLabel>Zustand</InputLabel>
        <Select
          label="Zustand"
          value={c.state || 'LOG_SUCCESS'}
          onChange={(e) => handleImmediateUpdate(upd({ state: e.target.value as QuestState }))}
        >
          <MenuItem value="LOG_RUNNING">LOG_RUNNING</MenuItem>
          <MenuItem value="LOG_SUCCESS">LOG_SUCCESS</MenuItem>
          <MenuItem value="LOG_FAILED">LOG_FAILED</MenuItem>
          <MenuItem value="LOG_OBSOLETE">LOG_OBSOLETE</MenuItem>
        </Select>
      </FormControl>
    </Box>
  );
}
