import React from 'react';
import { Box, TextField } from '@mui/material';
import type { ConditionEditorCondition } from '../dialogTypes';
import type { ConditionFieldsProps } from './conditionRegistry';

type C = { type: 'Condition'; condition: string; getTypeName?: () => string };

export default function ExpressionConditionFields({ condition, handleUpdate, flushUpdate, mainFieldRef }: ConditionFieldsProps) {
  const c = condition as unknown as C;
  const upd = (patch: Partial<C>): ConditionEditorCondition => ({ ...c, ...patch } as unknown as ConditionEditorCondition);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
      <TextField
        label="Condition Expression"
        value={c.condition || ''}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleUpdate(upd({ condition: e.target.value }))}
        onBlur={flushUpdate}
        size="small"
        inputRef={mainFieldRef}
        sx={{ flex: 1 }}
        placeholder="e.g., hero.attribute[ATR_STRENGTH] >= 50"
        multiline
        maxRows={3}
      />
    </Box>
  );
}
