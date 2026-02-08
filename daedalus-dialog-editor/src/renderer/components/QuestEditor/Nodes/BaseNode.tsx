import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { Handle, Position } from 'reactflow';

export interface BaseNodeProps {
  label: string;
  headerColor?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  selected?: boolean;
  width?: number;
}

const BaseNode: React.FC<BaseNodeProps> = ({
  label,
  headerColor = '#333',
  icon,
  children,
  selected = false,
  width = 250
}) => {
  return (
    <Paper
      elevation={selected ? 6 : 2}
      sx={{
        width,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: '#2b2b2b', // Dark background like Blender
        color: '#e0e0e0',
        border: selected ? '2px solid #ff9800' : '1px solid #444',
        transition: 'box-shadow 0.2s, border 0.2s',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          bgcolor: headerColor,
          p: 1,
          pl: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: '1px solid rgba(0,0,0,0.2)',
        }}
      >
        {icon && <Box component="span" sx={{ display: 'flex', opacity: 0.8 }}>{icon}</Box>}
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#fff' }}>
          {label}
        </Typography>
      </Box>

      {/* Body */}
      <Box sx={{ p: 1.5, position: 'relative' }}>
        {children}
      </Box>
    </Paper>
  );
};

export default BaseNode;
