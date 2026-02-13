import React from 'react';
import type { BaseActionRendererProps } from './types';
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
  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Target"
        value={action.target || ''}
        onChange={(value) => handleUpdate({ ...action, target: value })}
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
        value={action.item || ''}
        onChange={(value) => handleUpdate({ ...action, item: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ flex: 1 }}
        {...AUTOCOMPLETE_POLICIES.actions.item}
        semanticModel={semanticModel}
      />
      <ActionTextField
        label="Quantity"
        type="number"
        value={action.quantity || ''}
        onChange={(value) => handleUpdate({ ...action, quantity: parseInt(value) || 0 })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ width: 90 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default CreateInventoryItemsRenderer;
