import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';

const TeachActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const argsText = Array.isArray(action.teachArgs) ? action.teachArgs.join(', ') : '';

  return (
    <ActionFieldContainer>
      <ActionTextField
        label="Teach Function"
        value={action.teachFunctionName || ''}
        onChange={(value) => handleUpdate({ ...action, teachFunctionName: value })}
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
            ...action,
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

