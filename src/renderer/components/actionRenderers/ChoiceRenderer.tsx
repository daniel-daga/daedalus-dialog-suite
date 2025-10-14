import React from 'react';
import { Box, TextField, IconButton, Tooltip, Badge } from '@mui/material';
import { Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';
import { validateChoiceFunctionName } from '../dialogUtils';
import type { BaseActionRendererProps } from './types';

const ChoiceRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  semanticModel,
  onNavigateToFunction,
  onRenameFunction,
  dialogContextName
}) => {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <TextField
        label="Choice Text"
        value={action.text || ''}
        onChange={(e) => handleUpdate({ ...action, text: e.target.value })}
        size="small"
        inputRef={mainFieldRef}
        onBlur={flushUpdate}
        onKeyDown={handleKeyDown}
        sx={{ flex: '1 1 40%', minWidth: 150 }}
      />
      <TextField
        label="Function"
        value={action.targetFunction || ''}
        onChange={(e) => {
          const newName = e.target.value;
          handleUpdate({ ...action, targetFunction: newName });
        }}
        onBlur={() => {
          flushUpdate();
          // Validate and handle rename if needed
          if (dialogContextName && onRenameFunction && action.targetFunction !== action.targetFunction) {
            const validationError = validateChoiceFunctionName(
              action.targetFunction,
              dialogContextName,
              semanticModel,
              action.targetFunction
            );

            if (validationError) {
              // Revert to original name on validation error
              handleUpdate({ ...action, targetFunction: action.targetFunction });
              alert(validationError);
            } else if (action.targetFunction !== action.targetFunction) {
              // Valid rename - trigger the rename callback
              onRenameFunction(action.targetFunction, action.targetFunction);
            }
          }
        }}
        size="small"
        sx={{ flex: '1 1 40%', minWidth: 150 }}
        error={dialogContextName && action.targetFunction ? !action.targetFunction.startsWith(dialogContextName) : false}
      />
      {semanticModel && action.targetFunction && semanticModel.functions && semanticModel.functions[action.targetFunction] && onNavigateToFunction && (
        <Tooltip title="Edit choice actions" arrow>
          <Badge
            badgeContent={semanticModel.functions[action.targetFunction]?.actions?.length || 0}
            color="secondary"
            sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', height: '16px', minWidth: '16px' } }}
          >
            <IconButton
              size="small"
              color="primary"
              onClick={() => {
                flushUpdate();
                onNavigateToFunction(action.targetFunction);
              }}
              sx={{ flexShrink: 0 }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Badge>
        </Tooltip>
      )}
      <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

export default ChoiceRenderer;
