import React from 'react';
import { TextField, MenuItem, Box, Chip } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

const LogSetTopicStatusRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  semanticModel
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
        label="Status"
        value={action.status || 'LOG_RUNNING'}
        onChange={(e) => handleUpdate({ ...action, status: e.target.value })}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
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
