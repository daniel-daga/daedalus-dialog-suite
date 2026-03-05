import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { TeachActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';

const TeachActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as TeachActionType;
  const argsText = Array.isArray(typedAction.teachArgs) ? typedAction.teachArgs.join(', ') : '';

  return (
    <ActionFieldContainer>
      <ActionTextField
        label="Teach Function"
        value={typedAction.teachFunctionName || ''}
        onChange={(value) => handleUpdate({ ...typedAction, teachFunctionName: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 260 }}
      />
      <ActionTextField
        fullWidth
        label="Arguments (comma separated)"
        value={argsText}
        onChange={(value) =>
          handleUpdate({
            ...typedAction,
            teachArgs: value.split(',').map((part) => part.trim()).filter(Boolean)
          })
        }
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default TeachActionRenderer;