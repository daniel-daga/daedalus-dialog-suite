import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

const CreateTopicRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Topic"
        value={action.topic || ''}
        onChange={(value) => handleUpdate({ ...action, topic: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 180 }}
      />
      <ActionTextField
        fullWidth
        label="Topic Type"
        value={action.topicType || ''}
        onChange={(value) => handleUpdate({ ...action, topicType: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default CreateTopicRenderer;
