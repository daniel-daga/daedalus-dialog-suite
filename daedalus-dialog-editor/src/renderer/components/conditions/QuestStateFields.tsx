import { Box, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type QuestState = 'LOG_RUNNING' | 'LOG_SUCCESS' | 'LOG_FAILED' | 'LOG_OBSOLETE';
type C = { type: 'QuestStateCondition'; questVariable: string; state: QuestState; getTypeName?: () => string };

export default function QuestStateFields({ condition, handleUpdate, handleImmediateUpdate, flushUpdate, mainFieldRef, semanticModel }: ConditionFieldsProps) {
  const c = condition as unknown as C;
  const upd = (patch: Partial<C>): ConditionEditorCondition => ({ ...c, ...patch } as unknown as ConditionEditorCondition);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
      <VariableAutocomplete
        label="Quest-Variable"
        value={c.questVariable || ''}
        onChange={(value: string) => handleUpdate(upd({ questVariable: value }))}
        onFlush={flushUpdate}
        {...AUTOCOMPLETE_POLICIES.conditions.questVariable}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ flex: '1 1 55%', minWidth: 180 }}
        placeholder="e.g. MIS_Addon_Greg_ClearCanyon"
        semanticModel={semanticModel}
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
