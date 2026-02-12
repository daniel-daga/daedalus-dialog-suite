import React from 'react';
import { MenuItem, TextField } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';

const PickpocketActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const mode = action.pickpocketMode || 'B_Beklauen';

  return (
    <ActionFieldContainer>
      <TextField
        select
        label="Mode"
        value={mode}
        onChange={(e) => {
          const nextMode = e.target.value as 'B_Beklauen' | 'C_Beklauen';
          handleUpdate({ ...action, pickpocketMode: nextMode });
          flushUpdate();
        }}
        onKeyDown={handleKeyDown}
        size="small"
        sx={{ minWidth: 180 }}
        inputRef={mainFieldRef}
      >
        <MenuItem value="B_Beklauen">B_Beklauen (Execute)</MenuItem>
        <MenuItem value="C_Beklauen">C_Beklauen (Check)</MenuItem>
      </TextField>

      {mode === 'C_Beklauen' && (
        <>
          <ActionTextField
            label="Min"
            value={action.minChance || ''}
            onChange={(value) => handleUpdate({ ...action, minChance: value })}
            onFlush={flushUpdate}
            onKeyDown={handleKeyDown}
            sx={{ width: 100 }}
          />
          <ActionTextField
            label="Max"
            value={action.maxChance || ''}
            onChange={(value) => handleUpdate({ ...action, maxChance: value })}
            onFlush={flushUpdate}
            onKeyDown={handleKeyDown}
            sx={{ width: 100 }}
          />
        </>
      )}

      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default PickpocketActionRenderer;

