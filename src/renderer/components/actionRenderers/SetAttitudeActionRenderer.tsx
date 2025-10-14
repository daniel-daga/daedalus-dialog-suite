import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

const SetAttitudeActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  return (
    <ActionFieldContainer>
      <ActionTextField
        label="Target"
        value={action.target || ''}
        onChange={(value) => handleUpdate({ ...action, target: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 120 }}
      />
      <ActionTextField
        fullWidth
        label="Attitude"
        value={action.attitude || ''}
        onChange={(value) => handleUpdate({ ...action, attitude: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default SetAttitudeActionRenderer;
