import React from 'react';
import { TextField, MenuItem, IconButton, Tooltip } from '@mui/material';
import { MenuBook as MenuBookIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';
import type { CreateTopicAction } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { useProjectStore } from '../../store/projectStore';
import RegisterTopicDialog from '../RegisterTopicDialog';

const normalizeTopicName = (value: string): string => {
  const normalized = value.replace(/ /g, '_');
  if (normalized && !normalized.startsWith('TOPIC_')) {
    return `TOPIC_${normalized}`;
  }
  return normalized;
};

const CreateTopicRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  semanticModel
}) => {
  const typedAction = action as CreateTopicAction;
  const isProjectMode = useProjectStore((s) => !!s.projectPath);
  const [isRegisterOpen, setIsRegisterOpen] = React.useState(false);

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Topic"
        value={typedAction.topic || ''}
        onChange={(value) => handleUpdate({ ...typedAction, topic: normalizeTopicName(value) })}
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
        value={typedAction.topicType || 'LOG_MISSION'}
        onChange={(e) => handleUpdate({ ...typedAction, topicType: e.target.value })}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
        size="small"
      >
        <MenuItem value="LOG_MISSION">LOG_MISSION</MenuItem>
        <MenuItem value="LOG_NOTE">LOG_NOTE</MenuItem>
      </TextField>
      {isProjectMode && (
        <Tooltip title="Register quest in log files">
          <span>
            <IconButton
              size="small"
              aria-label="Register quest in log files"
              tabIndex={-1}
              disabled={!typedAction.topic}
              onClick={() => setIsRegisterOpen(true)}
            >
              <MenuBookIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      <ActionDeleteButton onClick={handleDelete} />
      {isProjectMode && (
        <RegisterTopicDialog
          open={isRegisterOpen}
          onClose={() => setIsRegisterOpen(false)}
          topicName={typedAction.topic || ''}
        />
      )}
    </ActionFieldContainer>
  );
};

export default CreateTopicRenderer;
