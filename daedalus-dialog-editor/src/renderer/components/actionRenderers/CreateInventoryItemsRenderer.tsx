import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { CreateInventoryItemsAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

const CreateInventoryItemsRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  semanticModel
}) => {
  const typedAction = action as CreateInventoryItemsAction;

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Target"
        value={typedAction.target || ''}
        onChange={(value) => handleUpdate({ ...typedAction, target: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 100 }}
        {...AUTOCOMPLETE_POLICIES.actions.npc}
        semanticModel={semanticModel}
      />
      <VariableAutocomplete
        label="Item"
        value={typedAction.item || ''}
        onChange={(value) => handleUpdate({ ...typedAction, item: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
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
        onKeyDown={handleKeyDown}
        sx={{ width: 90 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default CreateInventoryItemsRenderer;
