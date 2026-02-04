import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';

const CreateTopicRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  semanticModel
}) => {
  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Topic"
        value={action.topic || ''}
        onChange={(value) => handleUpdate({ ...action, topic: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 180 }}
        typeFilter="string"
        semanticModel={semanticModel}
      />
      <VariableAutocomplete
        fullWidth
        label="Topic Type"
        value={action.topicType || ''}
        onChange={(value) => handleUpdate({ ...action, topicType: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        typeFilter="int"
        semanticModel={semanticModel}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default CreateTopicRenderer;
