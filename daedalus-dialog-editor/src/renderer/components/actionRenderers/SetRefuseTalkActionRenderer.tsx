import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { SetRefuseTalkAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { Typography } from '@mui/material';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { displayNumericOrStringField, parseNumericOrStringField } from './numericStringField';

const SetRefuseTalkActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as SetRefuseTalkAction;

  return (
    <ActionFieldContainer>
      <Typography variant="body2" sx={{ mr: 2, whiteSpace: 'nowrap', fontWeight: 'bold', color: 'primary.main' }}>
        Refuse Talk
      </Typography>
      <VariableAutocomplete
        fullWidth
        label="Target"
        value={typedAction.target || 'self'}
        onChange={(value) => handleUpdate({ ...typedAction, target: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        {...AUTOCOMPLETE_POLICIES.actions.npcNoInstances}
      />
      <ActionTextField
        label="Seconds"
        value={displayNumericOrStringField(typedAction.seconds ?? 300)}
        onChange={(value) => handleUpdate({ ...typedAction, seconds: parseNumericOrStringField(value) })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ width: 120 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default SetRefuseTalkActionRenderer;
