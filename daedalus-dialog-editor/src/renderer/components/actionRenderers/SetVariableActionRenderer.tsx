import React from 'react';
import type { BaseActionRendererProps } from './types';
import type { SetVariableAction } from '../../../shared/types';
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
  const typedAction = action as SetVariableAction;

  return (
    <ActionFieldContainer>
      <VariableAutocomplete
        label="Variable"
        value={typedAction.variableName || ''}
        onChange={(value) => handleUpdate({ ...typedAction, variableName: value })}
        onFlush={flushUpdate}
        onKeyDown={handleKeyDown}
        isMainField
        mainFieldRef={mainFieldRef}
        sx={{ minWidth: 200 }}
        {...AUTOCOMPLETE_POLICIES.actions.setVariableName}
        semanticModel={semanticModel}
        textFieldProps={{
          error: !typedAction.variableName?.trim(),
          helperText: !typedAction.variableName?.trim() ? 'Variable name required' : undefined
        }}
      />
      <TextField
        select
        label="Op"
        value={typedAction.operator || '='}
        onChange={(e) => {
            handleUpdate({ ...typedAction, operator: e.target.value });
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
        value={String(typedAction.value !== undefined ? typedAction.value : '')}
        onChange={(e) => {
          const value = e.target.value;
          // Try to preserve number type if it looks like a number
          const num = Number(value);
          const isNum = !isNaN(num) && value.trim() !== '';
          handleUpdate({ ...typedAction, value: isNum ? num : value });
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
