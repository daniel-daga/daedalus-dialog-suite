import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { PlayAniAction } from '../../../shared/types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
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
  const typedAction = action as PlayAniAction;

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Target"
        value={typedAction.target || 'self'}
        onChange={(value) => handleUpdate({ ...typedAction, target: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 150 }}
        semanticModel={semanticModel}
        {...AUTOCOMPLETE_POLICIES.actions.npcNoInstances}
      />
      <VariableAutocomplete
        fullWidth
        label="Animation"
        value={typedAction.animationName || ''}
        onChange={(value) => handleUpdate({ ...typedAction, animationName: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        placeholder="e.g. T_SEARCH"
        sx={{ ml: 1 }}
        semanticModel={semanticModel}
        {...AUTOCOMPLETE_POLICIES.actions.animation}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default PlayAniActionRenderer;
