import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { LogEntryAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

const normalizeTopicName = (value: string): string => {
  const normalized = value.replace(/ /g, '_');
  if (normalized && !normalized.startsWith('TOPIC_')) {
    return `TOPIC_${normalized}`;
  }
  return normalized;
};

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

  // Topic field: Tab moves naturally to Text, Shift+Tab goes to previous action
  const handleTopicKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      return; // Let browser Tab naturally to the Text field
    }
    handleKeyDown(e);
  };

  // Text field: Tab goes to next action, Shift+Tab moves naturally back to Topic
  const handleTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && e.shiftKey) {
      return; // Let browser Shift+Tab naturally back to the Topic field
    }
    handleKeyDown(e);
  };

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Topic"
        value={typedAction.topic || ''}
        onChange={(value) => handleUpdate({ ...typedAction, topic: normalizeTopicName(value) })}
        onFlush={flushUpdate}
        onKeyDown={handleTopicKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
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
        onKeyDown={handleTextKeyDown}
        multiline
        rows={2}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default LogEntryRenderer;
