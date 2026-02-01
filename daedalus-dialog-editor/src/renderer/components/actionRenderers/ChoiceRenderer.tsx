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
  // Track the original function name when editing starts
  const originalFunctionNameRef = React.useRef<string | null>(null);

  // Track the current local value to avoid race condition with debounced updates
  const [localTargetFunction, setLocalTargetFunction] = React.useState(action.targetFunction || '');

  // Sync local state when action prop changes (e.g., from external updates)
  React.useEffect(() => {
    setLocalTargetFunction(action.targetFunction || '');
  }, [action.targetFunction]);

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
        value={localTargetFunction}
        onFocus={() => {
          // Capture the original function name when editing starts
          originalFunctionNameRef.current = localTargetFunction || null;
        }}
        onChange={(e) => {
          const newName = e.target.value;
          setLocalTargetFunction(newName);
          handleUpdate({ ...action, targetFunction: newName });
        }}
        onBlur={() => {
          flushUpdate();

          const originalName = originalFunctionNameRef.current;
          const newName = localTargetFunction; // Use local state, not stale props

          // Validate and handle rename if needed
          if (dialogContextName && onRenameFunction && originalName && newName !== originalName) {
            const validationError = validateChoiceFunctionName(
              newName,
              dialogContextName,
              semanticModel,
              originalName
            );

            if (validationError) {
              // Revert to original name on validation error
              setLocalTargetFunction(originalName);
              handleUpdate({ ...action, targetFunction: originalName });
              alert(validationError);
            } else {
              // Valid rename - trigger the rename callback
              onRenameFunction(originalName, newName);
            }
          }

          // Clear the original name reference
          originalFunctionNameRef.current = null;
        }}
        size="small"
        sx={{ flex: '1 1 40%', minWidth: 150 }}
        error={dialogContextName && localTargetFunction ? !localTargetFunction.startsWith(dialogContextName) : false}
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
              aria-label="Edit choice actions"
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Badge>
        </Tooltip>
      )}
      <Tooltip title="Delete choice">
        <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }} aria-label="Delete choice">
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default ChoiceRenderer;
