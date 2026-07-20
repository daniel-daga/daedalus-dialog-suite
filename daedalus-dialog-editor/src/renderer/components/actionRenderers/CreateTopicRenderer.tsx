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
import { createRowTabHandlers } from './rowTabNavigation';

const normalizeTopicName = (value: string): string => {
  const normalized = value.replace(/ /g, '_');
  if (normalized && !normalized.startsWith('TOPIC_')) {
    return `TOPIC_${normalized}`;
  }
  return normalized;
};

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const TOPIC_FIELD_SX = { minWidth: 180 };

const CreateTopicRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as CreateTopicAction;
  const isProjectMode = useProjectStore((s) => !!s.projectPath);
  const [isRegisterOpen, setIsRegisterOpen] = React.useState(false);

  const handleTopicChange = React.useCallback(
    (value: string) => handleUpdate({ ...typedAction, topic: normalizeTopicName(value) }),
    [handleUpdate, typedAction]
  );

  // #183 follow-up: Tab walks Topic -> Topic Type (the tabIndex=-1 book icon is
  // not part of the row); only the row edges hand off to card-to-card
  // navigation.
  const fieldKeyDown = React.useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

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
      <TextField
        select
        fullWidth
        label="Topic Type"
        value={typedAction.topicType || 'LOG_MISSION'}
        onChange={(e) => handleUpdate({ ...typedAction, topicType: e.target.value })}
        onBlur={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
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
      {/* Mounted only while open: the dialog subscribes to the project store
          and scans the merged model for file suggestions, and one instance is
          hosted per Create Topic action card. */}
      {isProjectMode && isRegisterOpen && (
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
