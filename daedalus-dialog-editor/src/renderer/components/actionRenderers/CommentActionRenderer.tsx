import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { CommentActionType } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

/**
 * The model keeps a comment's source text verbatim, marker included; the field
 * edits only the note behind it and always writes the marker back (#430), so an
 * edited note can never become a bare statement.
 */
const NOTE_PREFIX = '// ';
const noteBody = (text: string): string => text.replace(/^\/\/[ \t]?/, '');

const CommentActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as CommentActionType;

  return (
    <ActionFieldContainer>
      <ActionTextField
        fullWidth
        label="Comment"
        value={noteBody(typedAction.text || '')}
        onChange={(value) => handleUpdate({ ...typedAction, text: `${NOTE_PREFIX}${value}` })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{
          '& .MuiInputBase-input': {
            fontFamily: 'monospace',
            fontStyle: 'italic',
            color: 'text.secondary'
          }
        }}
      />
      <ActionDeleteButton onClick={handleDelete} tooltip="Delete comment" />
    </ActionFieldContainer>
  );
};

export default CommentActionRenderer;
