import React, { useMemo } from 'react';
import { MenuItem, TextField } from '@mui/material';
import type { BaseActionRendererProps } from './types';
import type { RemoveInventoryItemsActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';
import { createRowTabHandlers } from './rowTabNavigation';

const RemoveInventoryItemsActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as RemoveInventoryItemsActionType;
  const hasQuantity = (typedAction.removeFunctionName || 'Npc_RemoveInvItems').toLowerCase() === 'npc_removeinvitems';

  // Tab walks Function -> NPC -> Item -> optional Quantity; only the
  // row edges hand off to card-to-card navigation.
  const fieldKeyDown = useMemo(
    () => createRowTabHandlers(handleKeyDown, hasQuantity ? 4 : 3),
    [handleKeyDown, hasQuantity]
  );

  return (
    <ActionFieldContainer>
      <TextField
        select
        label="Function"
        value={typedAction.removeFunctionName || 'Npc_RemoveInvItems'}
        onChange={(e) => {
          const removeFunctionName = e.target.value as 'Npc_RemoveInvItems' | 'Npc_RemoveInvItem';
          handleUpdate({
            ...typedAction,
            removeFunctionName,
            removeQuantity: removeFunctionName === 'Npc_RemoveInvItems' ? typedAction.removeQuantity || '1' : undefined
          });
          flushUpdate();
        }}
        onKeyDown={fieldKeyDown[0]}
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
        onKeyDown={fieldKeyDown[1]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 140 }}
      />
      <ActionTextField
        label="Item"
        value={typedAction.removeItem || ''}
        onChange={(value) => handleUpdate({ ...typedAction, removeItem: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[2]}
        sx={{ minWidth: 180 }}
      />
      {hasQuantity && (
        <ActionTextField
          label="Quantity"
          value={typedAction.removeQuantity || ''}
          onChange={(value) => handleUpdate({ ...typedAction, removeQuantity: value })}
          onFlush={flushUpdate}
          onKeyDown={fieldKeyDown[3]}
          sx={{ minWidth: 180 }}
        />
      )}
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default RemoveInventoryItemsActionRenderer;

