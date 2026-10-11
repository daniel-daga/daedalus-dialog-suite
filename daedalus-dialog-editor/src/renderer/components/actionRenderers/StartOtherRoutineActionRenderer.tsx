import React, { useMemo } from 'react';
import { MenuItem, TextField } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import type { StartOtherRoutineActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';
import { createRowTabHandlers } from './rowTabNavigation';

const StartOtherRoutineActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as StartOtherRoutineActionType;

  // #183 follow-up: Tab walks Function -> NPC -> Routine; only the row edges
  // hand off to card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 3), [handleKeyDown]);

  return (
    <ActionFieldContainer>
      <TextField
        select
        label="Function"
        value={typedAction.routineFunctionName || 'B_StartOtherRoutine'}
        onChange={(e) => {
          handleUpdate({
            ...typedAction,
            routineFunctionName: e.target.value as 'B_StartOtherRoutine' | 'B_StartotherRoutine'
          });
          flushUpdate();
        }}
        onKeyDown={fieldKeyDown[0]}
        size="small"
        sx={{ minWidth: 200 }}
      >
        <MenuItem value="B_StartOtherRoutine">B_StartOtherRoutine</MenuItem>
        <MenuItem value="B_StartotherRoutine">B_StartotherRoutine</MenuItem>
      </TextField>
      <ActionTextField
        label="NPC"
        value={typedAction.routineNpc || ''}
        onChange={(value) => handleUpdate({ ...typedAction, routineNpc: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 160 }}
      />
      <ActionTextField
        label="Routine"
        value={typedAction.routineName || ''}
        onChange={(value) => handleUpdate({ ...typedAction, routineName: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[2]}
        sx={{ minWidth: 160 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default StartOtherRoutineActionRenderer;

