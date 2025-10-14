import React from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';

const LogEntryRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Topic"
        value={action.topic || ''}
        onChange={(e) => handleUpdate({ ...action, topic: e.target.value })}
        size="small"
        sx={{ minWidth: 180 }}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <TextField
        fullWidth
        label="Text"
        value={action.text || ''}
        onChange={(e) => handleUpdate({ ...action, text: e.target.value })}
        size="small"
        inputRef={mainFieldRef}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

export default LogEntryRenderer;
