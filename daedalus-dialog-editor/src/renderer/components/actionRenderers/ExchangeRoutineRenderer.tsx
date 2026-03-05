import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { ExchangeRoutineAction } from '../../types/global';
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
  const typedAction = action as ExchangeRoutineAction;

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Target NPC"
        value={typedAction.target || typedAction.npc || ''}
        onChange={(value) => {
          const updated: any = { ...typedAction, routine: typedAction.routine };
          if (typedAction.target !== undefined) {
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
        value={typedAction.routine || ''}
        onChange={(value) => handleUpdate({ ...typedAction, routine: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default ExchangeRoutineRenderer;
