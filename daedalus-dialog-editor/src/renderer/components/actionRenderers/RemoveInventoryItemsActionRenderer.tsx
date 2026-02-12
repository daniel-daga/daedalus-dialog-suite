import React from 'react';
import { MenuItem, TextField } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';

const RemoveInventoryItemsActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  return (
    <ActionFieldContainer>
      <TextField
        select
        label="Function"
        value={action.removeFunctionName || 'Npc_RemoveInvItems'}
        onChange={(e) => {
          handleUpdate({
            ...action,
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
        value={action.removeNpc || ''}
        onChange={(value) => handleUpdate({ ...action, removeNpc: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 140 }}
      />
      <ActionTextField
        label="Item"
        value={action.removeItem || ''}
        onChange={(value) => handleUpdate({ ...action, removeItem: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ minWidth: 180 }}
      />
      <ActionTextField
        label="Quantity"
        value={action.removeQuantity || ''}
        onChange={(value) => handleUpdate({ ...action, removeQuantity: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ minWidth: 180 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default RemoveInventoryItemsActionRenderer;

