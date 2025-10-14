import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

const CustomActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  return (
    <ActionFieldContainer alignItems="flex-start">
      <ActionTextField
        fullWidth
        label="Action"
        value={action.action || ''}
        onChange={(value) => handleUpdate({ ...action, action: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        multiline
        rows={2}
      />
      <ActionDeleteButton onClick={handleDelete} marginTop={0.5} />
    </ActionFieldContainer>
  );
};

export default CustomActionRenderer;
