import React, { useCallback } from 'react';
import type { BaseActionRendererProps } from './types';
import type { StopProcessInfosAction } from '../../../shared/types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { Typography } from '@mui/material';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

const StopProcessInfosActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as StopProcessInfosAction;

  const handleTargetChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, target: value }),
    [handleUpdate, typedAction]
  );

  return (
    <ActionFieldContainer>
      <Typography variant="body2" sx={{ mr: 2, whiteSpace: 'nowrap', fontWeight: 'bold', color: 'primary.main' }}>
        End Dialog
      </Typography>
      <VariableAutocomplete
        fullWidth
        label="Target"
        value={typedAction.target || 'self'}
        onChange={handleTargetChange}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        {...AUTOCOMPLETE_POLICIES.actions.npcNoInstances}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default StopProcessInfosActionRenderer;
