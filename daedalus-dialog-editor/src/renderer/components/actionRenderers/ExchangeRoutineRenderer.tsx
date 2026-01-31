import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

const ExchangeRoutineRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Target NPC"
        value={action.target || action.npc || ''}
        onChange={(value) => {
          const updated: any = { ...action, routine: action.routine };
          if (action.target !== undefined) {
            updated.target = value;
            delete updated.npc;
          } else {
            updated.npc = value;
            delete updated.target;
          }
          handleUpdate(updated);
        }}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 120 }}
      />
      <ActionTextField
        fullWidth
        label="Routine"
        value={action.routine || ''}
        onChange={(value) => handleUpdate({ ...action, routine: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default ExchangeRoutineRenderer;
