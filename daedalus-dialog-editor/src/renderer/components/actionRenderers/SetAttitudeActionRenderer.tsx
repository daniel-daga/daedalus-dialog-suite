import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { SetAttitudeActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

const SetAttitudeActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  semanticModel
}) => {
  const typedAction = action as SetAttitudeActionType;

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Target"
        value={typedAction.target || ''}
        onChange={(value) => handleUpdate({ ...typedAction, target: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 120 }}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
        semanticModel={semanticModel}
      />
      <VariableAutocomplete
        fullWidth
        label="Attitude"
        value={typedAction.attitude || ''}
        onChange={(value) => handleUpdate({ ...typedAction, attitude: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        {...AUTOCOMPLETE_POLICIES.actions.intVariable}
        semanticModel={semanticModel}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default SetAttitudeActionRenderer;
