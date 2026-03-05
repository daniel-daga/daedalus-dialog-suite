import React from 'react';
import { MenuItem, TextField } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import type { PickpocketActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';

const PickpocketActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as PickpocketActionType;
  const mode = typedAction.pickpocketMode || 'B_Beklauen';

  return (
    <ActionFieldContainer>
      <TextField
        select
        label="Mode"
        value={mode}
        onChange={(e) => {
          const nextMode = e.target.value as 'B_Beklauen' | 'C_Beklauen';
          handleUpdate({ ...typedAction, pickpocketMode: nextMode });
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
            value={typedAction.minChance || ''}
            onChange={(value) => handleUpdate({ ...typedAction, minChance: value })}
            onFlush={flushUpdate}
            onKeyDown={handleKeyDown}
            sx={{ width: 100 }}
          />
          <ActionTextField
            label="Max"
            value={typedAction.maxChance || ''}
            onChange={(value) => handleUpdate({ ...typedAction, maxChance: value })}
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