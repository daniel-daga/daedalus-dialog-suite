import React from 'react';
import { MenuItem, TextField } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';

const StartOtherRoutineActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  return (
    <ActionFieldContainer>
      <TextField
        select
        label="Function"
        value={action.routineFunctionName || 'B_StartOtherRoutine'}
        onChange={(e) => {
          handleUpdate({
            ...action,
            routineFunctionName: e.target.value as 'B_StartOtherRoutine' | 'B_StartotherRoutine'
          });
          flushUpdate();
        }}
        onKeyDown={handleKeyDown}
        size="small"
        sx={{ minWidth: 200 }}
      >
        <MenuItem value="B_StartOtherRoutine">B_StartOtherRoutine</MenuItem>
        <MenuItem value="B_StartotherRoutine">B_StartotherRoutine</MenuItem>
      </TextField>
      <ActionTextField
        label="NPC"
        value={action.routineNpc || ''}
        onChange={(value) => handleUpdate({ ...action, routineNpc: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 160 }}
      />
      <ActionTextField
        label="Routine"
        value={action.routineName || ''}
        onChange={(value) => handleUpdate({ ...action, routineName: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ minWidth: 160 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default StartOtherRoutineActionRenderer;

