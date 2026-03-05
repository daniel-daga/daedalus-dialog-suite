import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { LogEntryAction } from '../../types/global';
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
  const typedAction = action as LogEntryAction;

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Topic"
        value={typedAction.topic || ''}
        onChange={(value) => handleUpdate({ ...typedAction, topic: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ minWidth: 180 }}
        {...AUTOCOMPLETE_POLICIES.actions.topic}
        semanticModel={semanticModel}
      />
      <ActionTextField
        fullWidth
        label="Text"
        value={typedAction.text || ''}
        onChange={(value) => handleUpdate({ ...typedAction, text: value })}
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
