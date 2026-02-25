import React from 'react';
import type { BaseActionRendererProps } from './types';
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
      <VariableAutocomplete
        fullWidth
        label="Animation"
        value={action.animationName || ''}
        onChange={(value) => handleUpdate({ ...action, animationName: value })}
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
