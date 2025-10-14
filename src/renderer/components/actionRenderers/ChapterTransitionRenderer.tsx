import React from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';

const ChapterTransitionRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Chapter"
        type="number"
        value={action.chapter || ''}
        onChange={(e) => handleUpdate({ ...action, chapter: parseInt(e.target.value) || 0 })}
        size="small"
        sx={{ width: 100 }}
        inputRef={mainFieldRef}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <TextField
        fullWidth
        label="World"
        value={action.world || ''}
        onChange={(e) => handleUpdate({ ...action, world: e.target.value })}
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

export default ChapterTransitionRenderer;
