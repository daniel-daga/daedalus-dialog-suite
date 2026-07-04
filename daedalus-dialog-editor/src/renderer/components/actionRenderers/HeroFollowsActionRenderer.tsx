import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { HeroFollowsActionType } from '../../../shared/types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

const HeroFollowsActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as HeroFollowsActionType;

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        fullWidth
        label="Guide Routine"
        value={typedAction.guideRoutine || ''}
        onChange={(value) => handleUpdate({ ...typedAction, guideRoutine: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        placeholder="e.g. RTN_SZMYK_15_GUIDEMITTE"
        {...AUTOCOMPLETE_POLICIES.actions.routine}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default HeroFollowsActionRenderer;
