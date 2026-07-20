import React, { useCallback, useMemo } from 'react';
import { TextField, MenuItem, Box, Chip } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import type { LogSetTopicStatusAction } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const TOPIC_FIELD_SX = { minWidth: 180 };

const LogSetTopicStatusRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'LOG_RUNNING': return 'info';
      case 'LOG_SUCCESS': return 'success';
      case 'LOG_FAILED': return 'error';
      case 'LOG_OBSOLETE': return 'default';
      default: return 'default';
    }
  };

  const typedAction = action as LogSetTopicStatusAction;

  // #183 follow-up: Tab walks Topic -> Status; only the row edges hand off to
  // card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

  const handleTopicChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, topic: value }),
    [handleUpdate, typedAction]
  );

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
        label="Status"
        value={typedAction.status || 'LOG_RUNNING'}
        onChange={(e) => handleUpdate({ ...typedAction, status: e.target.value })}
        onBlur={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
        size="small"
      >
        {['LOG_RUNNING', 'LOG_SUCCESS', 'LOG_FAILED', 'LOG_OBSOLETE'].map((status) => (
          <MenuItem key={status} value={status}>
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label={status}
                size="small"
                color={getStatusColor(status) as any}
                variant="outlined"
                sx={{ height: 20, fontSize: '0.7rem', cursor: 'pointer' }}
              />
            </Box>
          </MenuItem>
        ))}
      </TextField>
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default LogSetTopicStatusRenderer;
