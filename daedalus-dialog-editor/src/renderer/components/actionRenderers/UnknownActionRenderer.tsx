import React from 'react';
import { Box, TextField, IconButton, Typography, Tooltip } from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';

const UnknownActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete
}) => {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" color="warning.main" gutterBottom>
            This action type is not recognized. Fields detected:
          </Typography>
          <TextField
            fullWidth
            label="Raw JSON"
            value={JSON.stringify(action, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                handleUpdate(parsed);
              } catch (err) {
                // Invalid JSON, ignore
              }
            }}
            size="small"
            multiline
            rows={6}
            helperText="Edit the raw JSON structure"
            sx={{ fontFamily: 'monospace' }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Properties: {Object.keys(action).join(', ')}
          </Typography>
        </Box>
        <Tooltip title="Delete action">
          <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }} aria-label="Delete action">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
};

export default UnknownActionRenderer;
