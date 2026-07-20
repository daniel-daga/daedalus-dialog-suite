import React, { useCallback, useMemo } from 'react';
import type { BaseActionRendererProps } from './types';
import type { InsertNpcActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const NPC_INSTANCE_FIELD_SX = { minWidth: 220 };

const InsertNpcActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as InsertNpcActionType;

  // #183 follow-up: Tab walks NPC Instance -> Spawn Point; only the row edges
  // hand off to card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

  const handleNpcInstanceChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, npcInstance: value }),
    [handleUpdate, typedAction]
  );

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="NPC Instance"
        value={typedAction.npcInstance || ''}
        onChange={handleNpcInstanceChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={NPC_INSTANCE_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
      />
      <ActionTextField
        fullWidth
        label="Spawn Point"
        value={typedAction.spawnPoint || ''}
        onChange={(value) => handleUpdate({ ...typedAction, spawnPoint: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default InsertNpcActionRenderer;
