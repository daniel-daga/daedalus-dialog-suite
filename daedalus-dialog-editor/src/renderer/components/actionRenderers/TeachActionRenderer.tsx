import React, { useMemo, useState } from 'react';
import type { BaseActionRendererProps } from './types';
import type { TeachActionType } from '../../types/global';
import { ActionFieldContainer, ActionDeleteButton, ActionTextField } from '../common';
import { createRowTabHandlers } from './rowTabNavigation';
import { splitDaedalusArguments } from './splitDaedalusArguments';

const TeachActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as TeachActionType;
  const argsText = Array.isArray(typedAction.teachArgs) ? typedAction.teachArgs.join(', ') : '';

  // The splitter drops empty arguments, so a controlled value would swallow a
  // comma the moment it is typed. Keep the raw text while editing and reset it
  // only when the action's arguments changed from elsewhere (undo, reload).
  const [text, setText] = useState(argsText);
  const [seenArgsText, setSeenArgsText] = useState(argsText);
  if (argsText !== seenArgsText) {
    setSeenArgsText(argsText);
    setText(argsText);
  }

  // #183 follow-up: Tab walks Teach Function -> Arguments; only the row edges
  // hand off to card-to-card navigation.
  const fieldKeyDown = useMemo(() => createRowTabHandlers(handleKeyDown, 2), [handleKeyDown]);

  return (
    <ActionFieldContainer>
      <ActionTextField
        label="Teach Function"
        value={typedAction.teachFunctionName || ''}
        onChange={(value) => handleUpdate({ ...typedAction, teachFunctionName: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[0]}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 260 }}
      />
      <ActionTextField
        fullWidth
        label="Arguments (comma separated)"
        value={text}
        onChange={(value) => {
          setText(value);
          handleUpdate({
            ...typedAction,
            teachArgs: splitDaedalusArguments(value)
          });
        }}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[1]}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default TeachActionRenderer;
