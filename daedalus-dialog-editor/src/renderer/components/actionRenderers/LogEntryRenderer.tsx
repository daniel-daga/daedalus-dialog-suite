import React, { useCallback, useMemo } from 'react';
import type { BaseActionRendererProps } from './types';
import type { LogEntryAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const TOPIC_FIELD_SX = { minWidth: 180 };

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
  mainFieldRef
}) => {
  const typedAction = action as LogEntryAction;

  const handleTopicChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, topic: normalizeTopicName(value) }),
    [handleUpdate, typedAction]
  );

  // #183 follow-up: Tab walks Topic -> Text; only the row edges hand off to
  // card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Topic"
        value={typedAction.topic || ''}
        onChange={handleTopicChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={TOPIC_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.topic}
      />
      <ActionTextField
        fullWidth
        label="Text"
        value={typedAction.text || ''}
        onChange={(value) => handleUpdate({ ...typedAction, text: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
        multiline
        rows={2}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default LogEntryRenderer;
