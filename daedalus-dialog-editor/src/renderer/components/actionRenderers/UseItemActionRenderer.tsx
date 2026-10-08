import React, { useCallback, useMemo } from 'react';
import type { BaseActionRendererProps } from './types';
import type { UseItemActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';

// Hoisted so VariableAutocomplete's memo sees stable sx identities (slice 4).
const TARGET_FIELD_SX = { width: 120 };
const ITEM_FIELD_SX = { flex: 1 };

/** `B_UseItem (npc, item);` (#304). */
const UseItemActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as UseItemActionType;

  // Tab walks Target -> Item; only the row edges hand off to card-to-card
  // navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

  const handleTargetChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, target: value }),
    [handleUpdate, typedAction]
  );

  const handleItemChange = useCallback(
    (value: string) => handleUpdate({ ...typedAction, item: value }),
    [handleUpdate, typedAction]
  );

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Target"
        value={typedAction.target || ''}
        onChange={handleTargetChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={TARGET_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
      />
      <VariableAutocomplete
        label="Item"
        value={typedAction.item || ''}
        onChange={handleItemChange}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
        sx={ITEM_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.item}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default UseItemActionRenderer;
