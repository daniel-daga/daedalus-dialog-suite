import React, { useCallback, useMemo } from 'react';
import type { BaseActionRendererProps } from './types';
import type { ExchangeRoutineAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const TARGET_FIELD_SX = { width: 120 };

const ExchangeRoutineRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as ExchangeRoutineAction;

  // #183 follow-up: Tab walks Target NPC -> Routine; only the row edges hand
  // off to card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

  const handleTargetChange = useCallback((value: string) => {
    const updated: any = { ...typedAction, routine: typedAction.routine };
    if (typedAction.target !== undefined) {
      updated.target = value;
      delete updated.npc;
    } else {
      updated.npc = value;
      delete updated.target;
    }
    handleUpdate(updated);
  }, [handleUpdate, typedAction]);

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Target NPC"
        value={typedAction.target || typedAction.npc || ''}
        onChange={handleTargetChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={TARGET_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
      />
      <ActionTextField
        fullWidth
        label="Routine"
        value={typedAction.routine || ''}
        onChange={(value) => handleUpdate({ ...typedAction, routine: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default ExchangeRoutineRenderer;
