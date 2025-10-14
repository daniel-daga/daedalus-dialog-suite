import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

const ChapterTransitionRenderer: React.FC<BaseActionRendererProps> = ({
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
        label="Chapter"
        type="number"
        value={action.chapter || ''}
        onChange={(value) => handleUpdate({ ...action, chapter: parseInt(value) || 0 })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 100 }}
      />
      <ActionTextField
        fullWidth
        label="World"
        value={action.world || ''}
        onChange={(value) => handleUpdate({ ...action, world: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default ChapterTransitionRenderer;
