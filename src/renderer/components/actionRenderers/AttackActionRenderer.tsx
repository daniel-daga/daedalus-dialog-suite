import React from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';

const AttackActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TextField
        label="Attacker"
        value={action.attacker || ''}
        onChange={(e) => handleUpdate({ ...action, attacker: e.target.value })}
        size="small"
        sx={{ width: 90 }}
        inputRef={mainFieldRef}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <TextField
        label="Target"
        value={action.target || ''}
        onChange={(e) => handleUpdate({ ...action, target: e.target.value })}
        size="small"
        sx={{ width: 80 }}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <TextField
        label="Reason"
        value={action.attackReason || ''}
        onChange={(e) => handleUpdate({ ...action, attackReason: e.target.value })}
        size="small"
        sx={{ flex: 1 }}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <TextField
        label="Damage"
        type="number"
        value={action.damage || ''}
        onChange={(e) => handleUpdate({ ...action, damage: parseInt(e.target.value) || 0 })}
        size="small"
        sx={{ width: 90 }}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

export default AttackActionRenderer;
