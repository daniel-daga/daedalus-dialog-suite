import React from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';

const ExchangeRoutineRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Target NPC"
        value={action.target || action.npc || ''}
        onChange={(e) => {
          const updated = { ...action, routine: action.routine };
          if (action.target !== undefined) {
            updated.target = e.target.value;
            delete updated.npc;
          } else {
            updated.npc = e.target.value;
            delete updated.target;
          }
          handleUpdate(updated);
        }}
        size="small"
        sx={{ width: 120 }}
        inputRef={mainFieldRef}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <TextField
        fullWidth
        label="Routine"
        value={action.routine || ''}
        onChange={(e) => handleUpdate({ ...action, routine: e.target.value })}
        size="small"
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

export default ExchangeRoutineRenderer;
