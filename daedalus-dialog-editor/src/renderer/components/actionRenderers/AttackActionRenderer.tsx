import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { AttackActionType } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { displayNumericOrStringField, parseNumericOrStringField } from './numericStringField';

const AttackActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as AttackActionType;

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Attacker"
        value={typedAction.attacker || ''}
        onChange={(value) => handleUpdate({ ...typedAction, attacker: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 90 }}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
      />
      <VariableAutocomplete
        label="Target"
        value={typedAction.target || ''}
        onChange={(value) => handleUpdate({ ...typedAction, target: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ width: 80 }}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
      />
      <ActionTextField
        label="Reason"
        value={typedAction.attackReason || ''}
        onChange={(value) => handleUpdate({ ...typedAction, attackReason: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ flex: 1 }}
      />
      <ActionTextField
        label="Damage"
        value={displayNumericOrStringField(typedAction.damage)}
        onChange={(value) => handleUpdate({ ...typedAction, damage: parseNumericOrStringField(value) })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ width: 90 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default AttackActionRenderer;
