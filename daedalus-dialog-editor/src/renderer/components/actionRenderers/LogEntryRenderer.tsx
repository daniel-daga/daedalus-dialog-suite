import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

const LogEntryRenderer: React.FC<BaseActionRendererProps> = ({
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
        sx={{ minWidth: 180 }}
        {...AUTOCOMPLETE_POLICIES.actions.topic}
        semanticModel={semanticModel}
      />
      <ActionTextField
        fullWidth
        label="Text"
        value={action.text || ''}
        onChange={(value) => handleUpdate({ ...action, text: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        multiline
        rows={2}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default LogEntryRenderer;
