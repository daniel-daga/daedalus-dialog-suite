import React, { useMemo } from 'react';
import { MenuItem, TextField } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import type { PickpocketActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';
import { createRowTabHandlers } from './rowTabNavigation';

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

  // #183 follow-up: Tab walks Mode -> Min -> Max in C_Beklauen mode (B_Beklauen
  // renders the Mode field alone); only the row edges hand off to card-to-card
  // navigation.
  const fieldCount = mode === 'C_Beklauen' ? 3 : 1;
  const fieldKeyDown = useMemo(
    () => createRowTabHandlers(handleKeyDown, fieldCount),
    [handleKeyDown, fieldCount]
  );

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
        onKeyDown={fieldKeyDown[0]}
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
            onKeyDown={fieldKeyDown[1]}
            sx={{ width: 100 }}
          />
          <ActionTextField
            label="Max"
            value={typedAction.maxChance || ''}
            onChange={(value) => handleUpdate({ ...typedAction, maxChance: value })}
            onFlush={flushUpdate}
            onKeyDown={fieldKeyDown[2]}
            sx={{ width: 100 }}
          />
        </>
      )}

      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default PickpocketActionRenderer;