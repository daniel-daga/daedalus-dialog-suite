import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import { TextField, MenuItem } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';

const SetVariableActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  semanticModel
}) => {
  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Variable"
        value={action.variableName || ''}
        onChange={(value) => handleUpdate({ ...action, variableName: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 200 }}
        semanticModel={semanticModel}
      />
      <TextField
        select
        label="Op"
        value={action.operator || '='}
        onChange={(e) => {
            handleUpdate({ ...action, operator: e.target.value });
            flushUpdate();
        }}
        onKeyDown={handleKeyDown}
        sx={{ width: 80, mx: 1 }}
        size="small"
        variant="outlined"
      >
        <MenuItem value="=">=</MenuItem>
        <MenuItem value="+=">+=</MenuItem>
        <MenuItem value="-=">-=</MenuItem>
      </TextField>
      <VariableAutocomplete
        fullWidth
        label="Value"
        value={String(action.value !== undefined ? action.value : '')}
        onChange={(value) => {
            // Try to preserve number type if it looks like a number
            const num = Number(value);
            const isNum = !isNaN(num) && value.trim() !== '';
            handleUpdate({ ...action, value: isNum ? num : value });
        }}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        semanticModel={semanticModel}
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default SetVariableActionRenderer;
