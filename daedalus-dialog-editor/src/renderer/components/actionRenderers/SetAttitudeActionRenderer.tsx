import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';

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
        showInstances
        typeFilter="C_NPC"
        semanticModel={semanticModel}
      />
      <VariableAutocomplete
        fullWidth
        label="Attitude"
        value={action.attitude || ''}
        onChange={(value) => handleUpdate({ ...action, attitude: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        typeFilter="int"
        semanticModel={semanticModel}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default SetAttitudeActionRenderer;
