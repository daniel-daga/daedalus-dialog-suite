import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { ClearChoicesAction } from '../../types/global';
import { ActionFieldContainer, ActionTextField, ActionDeleteButton } from '../common';
import { Typography } from '@mui/material';

const ClearChoicesActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const typedAction = action as ClearChoicesAction;

  return (
    <ActionFieldContainer>
      <Typography variant="body2" sx={{ mr: 2, whiteSpace: 'nowrap', fontWeight: 'bold', color: 'primary.main' }}>
        Clear Choices
      </Typography>
      <ActionTextField
        fullWidth
        label="Dialog Instance"
        value={typedAction.dialog || ''}
        onChange={(value) => handleUpdate({ ...typedAction, dialog: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default ClearChoicesActionRenderer;
