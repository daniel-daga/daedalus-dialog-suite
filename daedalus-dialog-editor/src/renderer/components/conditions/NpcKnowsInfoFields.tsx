import { Box, Typography } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type C = { type: 'NpcKnowsInfoCondition'; npc: string; dialogRef: string; getTypeName?: () => string };

export default function NpcKnowsInfoFields({ condition, handleUpdate, flushUpdate, mainFieldRef, semanticModel }: ConditionFieldsProps) {
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
        sx={{ flex: '1 1 30%', minWidth: 120 }}
        semanticModel={semanticModel}
      />
      <Typography sx={{ color: 'text.secondary', fontSize: '0.875rem', flexShrink: 0 }}>
        knows
      </Typography>
      <VariableAutocomplete
        label="Dialog"
        value={c.dialogRef || ''}
        onChange={(value: string) => handleUpdate(upd({ dialogRef: value }))}
        onFlush={flushUpdate}
        {...AUTOCOMPLETE_POLICIES.conditions.npcKnowsDialog}
        sx={{ flex: '1 1 60%', minWidth: 150 }}
        semanticModel={semanticModel}
      />
    </Box>
  );
}
