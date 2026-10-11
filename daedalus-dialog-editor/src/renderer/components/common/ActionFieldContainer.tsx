import React from 'react';
import { Box, SxProps, Theme } from '@mui/material';

/**
 * Props for ActionFieldContainer
 */
export interface ActionFieldContainerProps {
  /** Child elements (fields and buttons) */
  children: React.ReactNode;
  /** Vertical alignment (default: 'center') */
  alignItems?: 'center' | 'flex-start' | 'flex-end';
  /** Optional additional sx props */
  sx?: SxProps<Theme>;
}

/**
 * Standardized container for action renderer fields
 * Provides consistent flex layout across all action types
 */
const ActionFieldContainer: React.FC<ActionFieldContainerProps> = ({
  children,
  alignItems = 'center',
  sx = {}
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems,
        gap: 1,
        ...sx
      }}
    >
      {children}
    </Box>
  );
};

export default ActionFieldContainer;
