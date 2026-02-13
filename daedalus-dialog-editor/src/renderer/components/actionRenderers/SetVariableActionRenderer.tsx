import React from 'react';
import type { BaseActionRendererProps } from './types';
import { ActionFieldContainer, ActionDeleteButton } from '../common';
import { TextField, MenuItem } from '@mui/material';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';

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
        {...AUTOCOMPLETE_POLICIES.actions.setVariableName}
        semanticModel={semanticModel}
        textFieldProps={{
          error: !action.variableName?.trim(),
          helperText: !action.variableName?.trim() ? 'Variable name required' : undefined
        }}
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
      <TextField
        fullWidth
        label="Value"
        value={String(action.value !== undefined ? action.value : '')}
        onChange={(e) => {
          const value = e.target.value;
          // Try to preserve number type if it looks like a number
          const num = Number(value);
          const isNum = !isNaN(num) && value.trim() !== '';
          handleUpdate({ ...action, value: isNum ? num : value });
        }}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
        size="small"
        variant="outlined"
      />
      <ActionDeleteButton onClick={handleDelete} />
    </ActionFieldContainer>
  );
};

export default SetVariableActionRenderer;
