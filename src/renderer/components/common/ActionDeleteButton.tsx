import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';

/**
 * Props for ActionDeleteButton
 */
export interface ActionDeleteButtonProps {
  /** Callback when delete button is clicked */
  onClick: () => void;
  /** Optional tooltip text (default: "Delete action") */
  tooltip?: string;
  /** Optional margin top adjustment for multiline fields */
  marginTop?: number;
}

/**
 * Standardized delete button for action renderers
 * Provides consistent styling and behavior across all action types
 */
const ActionDeleteButton: React.FC<ActionDeleteButtonProps> = ({
  onClick,
  tooltip = 'Delete action',
  marginTop
}) => {
  return (
    <Tooltip title={tooltip} arrow>
      <IconButton
        size="small"
        color="error"
        onClick={onClick}
        sx={{ flexShrink: 0, ...(marginTop !== undefined && { mt: marginTop }) }}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
};

export default ActionDeleteButton;
