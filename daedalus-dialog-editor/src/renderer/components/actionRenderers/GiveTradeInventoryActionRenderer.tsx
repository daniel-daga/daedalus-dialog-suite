import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { GiveTradeInventoryActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';

const GiveTradeInventoryActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as GiveTradeInventoryActionType;

  return (
    <ActionFieldContainer>
      <ActionTextField
        fullWidth
        label="Trade Target"
        value={typedAction.tradeTarget || ''}
        onChange={(value) => handleUpdate({ ...typedAction, tradeTarget: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default GiveTradeInventoryActionRenderer;

