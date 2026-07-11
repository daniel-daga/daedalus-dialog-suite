import { useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type C = { type: 'NpcKnowsInfoCondition'; npc: string; dialogRef: string; getTypeName?: () => string };

// Hoisted so VariableAutocomplete's memo sees stable sx identities (slice 4).
const NPC_FIELD_SX = { flex: '1 1 30%', minWidth: 120 };
const DIALOG_FIELD_SX = { flex: '1 1 60%', minWidth: 150 };

export default function NpcKnowsInfoFields({ condition, handleUpdate, flushUpdate, mainFieldRef, semanticModel }: ConditionFieldsProps) {
  const c = condition as unknown as C;
  const upd = useCallback(
    (patch: Partial<C>): ConditionEditorCondition => ({ ...c, ...patch } as unknown as ConditionEditorCondition),
    [c]
  );
  const handleNpcChange = useCallback(
    (value: string) => handleUpdate(upd({ npc: value })),
    [handleUpdate, upd]
  );
  const handleDialogRefChange = useCallback(
    (value: string) => handleUpdate(upd({ dialogRef: value })),
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
        semanticModel={semanticModel}
      />
      <Typography sx={{ color: 'text.secondary', fontSize: '0.875rem', flexShrink: 0 }}>
        knows
      </Typography>
      <VariableAutocomplete
        label="Dialog"
        value={c.dialogRef || ''}
        onChange={handleDialogRefChange}
        onFlush={flushUpdate}
        {...AUTOCOMPLETE_POLICIES.conditions.npcKnowsDialog}
        sx={DIALOG_FIELD_SX}
        semanticModel={semanticModel}
      />
    </Box>
  );
}
