import React, { useCallback } from 'react';
import type { BaseActionRendererProps } from './types';
import type { AttackActionType } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { displayNumericOrStringField, parseNumericOrStringField } from './numericStringField';

// Hoisted so VariableAutocomplete's memo sees stable sx identities (slice 4).
const ATTACKER_FIELD_SX = { width: 90 };
const TARGET_FIELD_SX = { width: 80 };

const AttackActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as AttackActionType;

  const handleAttackerChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, attacker: value }),
    [handleUpdate, typedAction]
  );

  const handleTargetChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, target: value }),
    [handleUpdate, typedAction]
  );

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Attacker"
        value={typedAction.attacker || ''}
        onChange={handleAttackerChange}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={ATTACKER_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
      />
      <VariableAutocomplete
        label="Target"
        value={typedAction.target || ''}
        onChange={handleTargetChange}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={TARGET_FIELD_SX}
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
