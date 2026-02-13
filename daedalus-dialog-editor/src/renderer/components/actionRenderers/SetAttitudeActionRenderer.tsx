import React from 'react';
import type { BaseActionRendererProps } from './types';
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
  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Target"
        value={action.target || ''}
        onChange={(value) => handleUpdate({ ...action, target: value })}
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
        value={action.attitude || ''}
        onChange={(value) => handleUpdate({ ...action, attitude: value })}
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
