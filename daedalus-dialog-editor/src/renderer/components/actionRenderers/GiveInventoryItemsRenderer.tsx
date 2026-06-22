import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { GiveInventoryItemsAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';

const GiveInventoryItemsRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  semanticModel
}) => {
  const typedAction = action as GiveInventoryItemsAction;

  // Issue #183 (item 3): keep Tab inside the row (Giver -> Receiver -> Item ->
  // Quantity); only the edges hand off to card-to-card navigation.
  const fieldKeyDown = createRowTabHandlers(handleKeyDown, 4);

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Giver"
        value={typedAction.giver || ''}
        onChange={(value) => handleUpdate({ ...typedAction, giver: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 80 }}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
        semanticModel={semanticModel}
      />
      <VariableAutocomplete
        label="Receiver"
        value={typedAction.receiver || ''}
        onChange={(value) => handleUpdate({ ...typedAction, receiver: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
        sx={{ width: 90 }}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
        semanticModel={semanticModel}
      />
      <VariableAutocomplete
        label="Item"
        value={typedAction.item || ''}
        onChange={(value) => handleUpdate({ ...typedAction, item: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[2]}
        sx={{ flex: 1 }}
        {...AUTOCOMPLETE_POLICIES.actions.item}
        semanticModel={semanticModel}
      />
      <ActionTextField
        label="Quantity"
        type="number"
        value={typedAction.quantity || ''}
        onChange={(value) => handleUpdate({ ...typedAction, quantity: parseInt(value) || 0 })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[3]}
        sx={{ width: 90 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default GiveInventoryItemsRenderer;
