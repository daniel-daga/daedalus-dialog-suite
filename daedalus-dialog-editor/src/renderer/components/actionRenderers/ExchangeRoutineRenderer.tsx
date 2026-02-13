import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

const ExchangeRoutineRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Target NPC"
        value={action.target || action.npc || ''}
        onChange={(value) => {
          const updated: any = { ...action, routine: action.routine };
          if (action.target !== undefined) {
            updated.target = value;
            delete updated.npc;
          } else {
            updated.npc = value;
            delete updated.target;
          }
          handleUpdate(updated);
        }}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 120 }}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
        semanticModel={semanticModel}
      />
      <ActionTextField
        fullWidth
        label="Routine"
        value={action.routine || ''}
        onChange={(value) => handleUpdate({ ...action, routine: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default ExchangeRoutineRenderer;
