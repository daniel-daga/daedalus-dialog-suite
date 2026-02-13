import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { TextField } from '@mui/material';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

const PlayAniActionRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Target"
        value={action.target || 'self'}
        onChange={(value) => handleUpdate({ ...action, target: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 150 }}
        semanticModel={semanticModel}
        {...AUTOCOMPLETE_POLICIES.actions.npcNoInstances}
      />
      <TextField
        fullWidth
        label="Animation Name"
        value={action.animationName || ''}
        onChange={(e) => handleUpdate({ ...action, animationName: e.target.value })}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
        size="small"
        variant="outlined"
        placeholder="e.g. T_SEARCH"
        sx={{ ml: 1 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default PlayAniActionRenderer;
