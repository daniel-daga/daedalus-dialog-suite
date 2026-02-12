import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';

const InsertNpcActionRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="NPC Instance"
        value={action.npcInstance || ''}
        onChange={(value) => handleUpdate({ ...action, npcInstance: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 220 }}
      />
      <ActionTextField
        fullWidth
        label="Spawn Point"
        value={action.spawnPoint || ''}
        onChange={(value) => handleUpdate({ ...action, spawnPoint: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default InsertNpcActionRenderer;

