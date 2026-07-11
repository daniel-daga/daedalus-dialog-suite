import React, { useCallback } from 'react';
import type { BaseActionRendererProps } from './types';
import type { SetAttitudeActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const TARGET_FIELD_SX = { width: 120 };

const SetAttitudeActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as SetAttitudeActionType;

  const handleTargetChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, target: value }),
    [handleUpdate, typedAction]
  );

  const handleAttitudeChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, attitude: value }),
    [handleUpdate, typedAction]
  );

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Target"
        value={typedAction.target || ''}
        onChange={handleTargetChange}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={TARGET_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
      />
      <VariableAutocomplete
        fullWidth
        label="Attitude"
        value={typedAction.attitude || ''}
        onChange={handleAttitudeChange}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        {...AUTOCOMPLETE_POLICIES.actions.intVariable}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default SetAttitudeActionRenderer;
