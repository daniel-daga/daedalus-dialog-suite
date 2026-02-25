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
  mainFieldRef,
  index
}) => {
  const lineNumber = typeof index === 'number' ? index + 1 : null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {lineNumber !== null && (
        <Box
          sx={{
            minWidth: 32,
            textAlign: 'right',
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500
          }}
          aria-label={`Dialog line ${lineNumber}`}
        >
          {lineNumber}.
        </Box>
      )}
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
          <IconButton size="small" sx={{ flexShrink: 0 }} aria-label={`Dialog ID: ${action.id}`}>
            <InfoIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Delete dialog line">
        <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }} aria-label="Delete dialog line">
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default DialogLineRenderer;
