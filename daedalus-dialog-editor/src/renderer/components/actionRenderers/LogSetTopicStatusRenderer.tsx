import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';

const LogSetTopicStatusRenderer: React.FC<BaseActionRendererProps> = ({
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
        namePrefix="TOPIC_"
        semanticModel={semanticModel}
      />
      <VariableAutocomplete
        fullWidth
        label="Status"
        value={action.status || ''}
        onChange={(value) => handleUpdate({ ...action, status: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        typeFilter="int"
        namePrefix="LOG_"
        semanticModel={semanticModel}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default LogSetTopicStatusRenderer;
