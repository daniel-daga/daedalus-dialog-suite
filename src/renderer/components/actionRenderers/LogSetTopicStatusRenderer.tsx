import React from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';

const LogSetTopicStatusRenderer: React.FC<BaseActionRendererProps> = ({
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
        inputRef={mainFieldRef}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <TextField
        fullWidth
        label="Status"
        value={action.status || ''}
        onChange={(e) => handleUpdate({ ...action, status: e.target.value })}
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

export default LogSetTopicStatusRenderer;
