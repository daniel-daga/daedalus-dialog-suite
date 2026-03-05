import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { ChapterTransitionAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

const ChapterTransitionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as ChapterTransitionAction;

  return (
    <ActionFieldContainer>
      <ActionTextField
        label="Chapter"
        type="number"
        value={typedAction.chapter || ''}
        onChange={(value) => handleUpdate({ ...typedAction, chapter: parseInt(value) || 0 })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ width: 100 }}
      />
      <ActionTextField
        fullWidth
        label="World"
        value={typedAction.world || ''}
        onChange={(value) => handleUpdate({ ...typedAction, world: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default ChapterTransitionRenderer;
