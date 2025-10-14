import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

const CreateInventoryItemsRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  return (
    <ActionFieldContainer>
      <ActionTextField
        label="Target"
        value={action.target || ''}
        onChange={(value) => handleUpdate({ ...action, target: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 100 }}
      />
      <ActionTextField
        label="Item"
        value={action.item || ''}
        onChange={(value) => handleUpdate({ ...action, item: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ flex: 1 }}
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
