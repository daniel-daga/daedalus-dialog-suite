import React, { useCallback } from 'react';
import type { BaseActionRendererProps } from './types';
import type { CreateInventoryItemsAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { displayNumericOrStringField, parseNumericOrStringField } from './numericStringField';

// Hoisted so VariableAutocomplete's memo sees stable sx identities (slice 4).
const TARGET_FIELD_SX = { width: 100 };
const ITEM_FIELD_SX = { flex: 1 };

const CreateInventoryItemsRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as CreateInventoryItemsAction;

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
        onKeyDown={handleKeyDown}
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
        onKeyDown={handleKeyDown}
        sx={ITEM_FIELD_SX}
        {...AUTOCOMPLETE_POLICIES.actions.item}
      />
      <ActionTextField
        label="Quantity"
        value={displayNumericOrStringField(typedAction.quantity)}
        onChange={(value) => handleUpdate({ ...typedAction, quantity: parseNumericOrStringField(value) })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ width: 90 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default CreateInventoryItemsRenderer;
