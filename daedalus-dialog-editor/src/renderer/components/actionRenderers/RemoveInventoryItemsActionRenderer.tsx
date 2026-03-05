import React from 'react';
import { MenuItem, TextField } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import type { RemoveInventoryItemsActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';

const RemoveInventoryItemsActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as RemoveInventoryItemsActionType;

  return (
    <ActionFieldContainer>
      <TextField
        select
        label="Function"
        value={typedAction.removeFunctionName || 'Npc_RemoveInvItems'}
        onChange={(e) => {
          handleUpdate({
            ...typedAction,
            removeFunctionName: e.target.value as 'Npc_RemoveInvItems' | 'Npc_RemoveInvItem'
          });
          flushUpdate();
        }}
        onKeyDown={handleKeyDown}
        size="small"
        sx={{ minWidth: 200 }}
      >
        <MenuItem value="Npc_RemoveInvItems">Npc_RemoveInvItems</MenuItem>
        <MenuItem value="Npc_RemoveInvItem">Npc_RemoveInvItem</MenuItem>
      </TextField>
      <ActionTextField
        label="NPC"
        value={typedAction.removeNpc || ''}
        onChange={(value) => handleUpdate({ ...typedAction, removeNpc: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 140 }}
      />
      <ActionTextField
        label="Item"
        value={typedAction.removeItem || ''}
        onChange={(value) => handleUpdate({ ...typedAction, removeItem: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ minWidth: 180 }}
      />
      <ActionTextField
        label="Quantity"
        value={typedAction.removeQuantity || ''}
        onChange={(value) => handleUpdate({ ...typedAction, removeQuantity: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ minWidth: 180 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default RemoveInventoryItemsActionRenderer;

