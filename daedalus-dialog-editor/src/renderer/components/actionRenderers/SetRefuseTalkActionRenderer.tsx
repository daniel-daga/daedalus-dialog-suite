import React, { useCallback, useMemo } from 'react';
import type { BaseActionRendererProps } from './types';
import type { SetRefuseTalkAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { Typography } from '@mui/material';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { displayNumericOrStringField, parseNumericOrStringField } from './numericStringField';
import { createRowTabHandlers } from './rowTabNavigation';

const SetRefuseTalkActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as SetRefuseTalkAction;

  // #183 follow-up: Tab walks Target -> Seconds (the leading label is not a
  // field); only the row edges hand off to card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

  const handleTargetChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, target: value }),
    [handleUpdate, typedAction]
  );

  return (
    <ActionFieldContainer>
      <Typography variant="body2" sx={{ mr: 2, whiteSpace: 'nowrap', fontWeight: 'bold', color: 'primary.main' }}>
        Refuse Talk
      </Typography>
      <VariableAutocomplete
        fullWidth
        label="Target"
        value={typedAction.target || 'self'}
        onChange={handleTargetChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        {...AUTOCOMPLETE_POLICIES.actions.npcNoInstances}
      />
      <ActionTextField
        label="Seconds"
        value={displayNumericOrStringField(typedAction.seconds ?? 300)}
        onChange={(value) => handleUpdate({ ...typedAction, seconds: parseNumericOrStringField(value) })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
        sx={{ width: 120 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default SetRefuseTalkActionRenderer;
