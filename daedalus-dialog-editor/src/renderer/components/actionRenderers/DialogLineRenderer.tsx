import React from 'react';
import { Box, TextField, IconButton, Tooltip, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';
import type { DialogLineAction } from '../../types/global';
import { getOppositeSpeaker } from '../actionTemplates';

const DialogLineRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  npcName,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as DialogLineAction;

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <FormControl size="small" sx={{ width: 150, flexShrink: 0 }}>
        <InputLabel>Speaker</InputLabel>
        <Select
          value={typedAction.speaker || 'self'}
          label="Speaker"
          onChange={(e) => {
            const speaker = e.target.value as 'self' | 'other';
            handleUpdate({
              ...typedAction,
              speaker,
              // AI_Output takes (speaker, listener, id). A parsed line already
              // carries its listener, so the generator's speaker-derived
              // fallback never runs: without this the new speaker talks to
              // itself (`AI_Output (other, other, …)`) and nothing warns (#457).
              listener: typedAction.listener === 'self'
                ? 'other'
                : typedAction.listener === 'other'
                  ? 'self'
                  : getOppositeSpeaker(speaker)
            });
          }}
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
        value={typedAction.text || ''}
        onChange={(e) => handleUpdate({ ...typedAction, text: e.target.value })}
        multiline
        minRows={1}
        inputProps={{ style: { resize: 'vertical' } }}
        size="small"
        inputRef={mainFieldRef}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <Tooltip title="Delete dialog line">
        <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }} aria-label="Delete dialog line">
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default DialogLineRenderer;
