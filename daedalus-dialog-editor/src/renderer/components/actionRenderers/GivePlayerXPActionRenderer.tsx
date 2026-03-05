import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { GivePlayerXPActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';

const GivePlayerXPActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as GivePlayerXPActionType;

  return (
    <ActionFieldContainer>
      <ActionTextField
        fullWidth
        label="XP Amount"
        value={typedAction.xpAmount || ''}
        onChange={(value) => handleUpdate({ ...typedAction, xpAmount: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default GivePlayerXPActionRenderer;

