import React from 'react';
import { Box, TextField, IconButton, Tooltip, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { Delete as DeleteIcon, Info as InfoIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';

const DialogLineRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  npcName,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FormControl size="small" sx={{ width: 150, flexShrink: 0 }}>
        <InputLabel>Speaker</InputLabel>
        <Select
          value={action.speaker || 'self'}
          label="Speaker"
          onChange={(e) => handleUpdate({ ...action, speaker: e.target.value })}
          onBlur={flushUpdate}
          onKeyDown={handleKeyDown}
        >
          <MenuItem value="self">{npcName}</MenuItem>
          <MenuItem value="other">Hero</MenuItem>
        </Select>
      </FormControl>
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
      {action.id && (
        <Tooltip title={`Dialog ID: ${action.id}`} arrow>
          <IconButton size="small" sx={{ flexShrink: 0 }}>
            <InfoIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

export default DialogLineRenderer;
