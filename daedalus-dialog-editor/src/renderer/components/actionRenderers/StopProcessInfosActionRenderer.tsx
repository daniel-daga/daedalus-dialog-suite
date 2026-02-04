import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { Typography } from '@mui/material';

const StopProcessInfosActionRenderer: React.FC<BaseActionRendererProps> = ({
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
      <Typography variant="body2" sx={{ mr: 2, whiteSpace: 'nowrap', fontWeight: 'bold', color: 'primary.main' }}>
        End Dialog
      </Typography>
      <VariableAutocomplete
        fullWidth
        label="Target"
        value={action.target || 'self'}
        onChange={(value) => handleUpdate({ ...action, target: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        semanticModel={semanticModel}
        typeFilter="C_NPC"
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default StopProcessInfosActionRenderer;
