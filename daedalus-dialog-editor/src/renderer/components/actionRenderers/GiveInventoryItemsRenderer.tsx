import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';

const GiveInventoryItemsRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Giver"
        value={action.giver || ''}
        onChange={(value) => handleUpdate({ ...action, giver: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 80 }}
        showInstances
        typeFilter="C_NPC"
        semanticModel={semanticModel}
      />
      <VariableAutocomplete
        label="Receiver"
        value={action.receiver || ''}
        onChange={(value) => handleUpdate({ ...action, receiver: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ width: 90 }}
        showInstances
        typeFilter="C_NPC"
        semanticModel={semanticModel}
      />
      <VariableAutocomplete
        label="Item"
        value={action.item || ''}
        onChange={(value) => handleUpdate({ ...action, item: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ flex: 1 }}
        showInstances
        typeFilter="C_ITEM"
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

export default GiveInventoryItemsRenderer;
