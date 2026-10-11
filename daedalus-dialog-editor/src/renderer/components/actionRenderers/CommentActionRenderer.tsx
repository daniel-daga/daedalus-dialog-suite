import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { CommentActionType } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';

/**
 * Read-only display for a standalone comment preserved from source (parser's
 * `CommentAction`). Comments are not structurally editable in the dialog UI,
 * but must render without crashing and survive round-trips (delete-only).
 */
const CommentActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleDelete,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as CommentActionType;

  return (
    <ActionFieldContainer>
      <ActionTextField
        fullWidth
        label="Comment"
        value={typedAction.text || ''}
        onChange={() => { /* read-only: comments are not editable */ }}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        InputProps={{ readOnly: true }}
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
