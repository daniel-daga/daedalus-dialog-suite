import React from 'react';
import { TextField, MenuItem } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

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
        {...AUTOCOMPLETE_POLICIES.actions.topic}
        semanticModel={semanticModel}
      />
      <TextField
        select
        fullWidth
        label="Topic Type"
        value={action.topicType || 'LOG_MISSION'}
        onChange={(e) => handleUpdate({ ...action, topicType: e.target.value })}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
        size="small"
      >
        <MenuItem value="LOG_MISSION">LOG_MISSION</MenuItem>
        <MenuItem value="LOG_NOTE">LOG_NOTE</MenuItem>
      </TextField>
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default CreateTopicRenderer;
