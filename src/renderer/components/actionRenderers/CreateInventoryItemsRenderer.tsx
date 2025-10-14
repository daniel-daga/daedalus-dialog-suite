import React from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';

const CreateInventoryItemsRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Target"
        value={action.target || ''}
        onChange={(e) => handleUpdate({ ...action, target: e.target.value })}
        size="small"
        sx={{ width: 100 }}
        inputRef={mainFieldRef}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <TextField
        label="Item"
        value={action.item || ''}
        onChange={(e) => handleUpdate({ ...action, item: e.target.value })}
        size="small"
        sx={{ flex: 1 }}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <TextField
        label="Quantity"
        type="number"
        value={action.quantity || ''}
        onChange={(e) => handleUpdate({ ...action, quantity: parseInt(e.target.value) || 0 })}
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

export default CreateInventoryItemsRenderer;
