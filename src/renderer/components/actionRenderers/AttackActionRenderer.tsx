import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

const AttackActionRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Attacker"
        value={action.attacker || ''}
        onChange={(value) => handleUpdate({ ...action, attacker: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 90 }}
      />
      <ActionTextField
        label="Target"
        value={action.target || ''}
        onChange={(value) => handleUpdate({ ...action, target: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ width: 80 }}
      />
      <ActionTextField
        label="Reason"
        value={action.attackReason || ''}
        onChange={(value) => handleUpdate({ ...action, attackReason: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ flex: 1 }}
      />
      <ActionTextField
        label="Damage"
        type="number"
        value={action.damage || ''}
        onChange={(value) => handleUpdate({ ...action, damage: parseInt(value) || 0 })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ width: 90 }}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default AttackActionRenderer;
