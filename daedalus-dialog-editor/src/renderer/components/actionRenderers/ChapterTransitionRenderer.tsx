import React, { useMemo } from 'react';
import type { BaseActionRendererProps } from './types';
import type { ChapterTransitionAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import { displayNumericOrStringField, parseNumericOrStringField } from './numericStringField';
import { createRowTabHandlers } from './rowTabNavigation';

const ChapterTransitionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as ChapterTransitionAction;

  // #183 follow-up: Tab walks Chapter -> World; only the row edges hand off to
  // card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

  return (
    <ActionFieldContainer>
      <ActionTextField
        label="Chapter"
        value={displayNumericOrStringField(typedAction.chapter)}
        onChange={(value) => handleUpdate({ ...typedAction, chapter: parseNumericOrStringField(value) })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
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
        onKeyDown={fieldKeyDown[1]}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default ChapterTransitionRenderer;
