import React from 'react';
import { Box, Typography, Alert, Paper, List, ListItem, ListItemText } from '@mui/material';
import type { ParseError } from '../types/global';

interface SyntaxErrorsDisplayProps {
  errors: ParseError[];
  filePath: string | null;
}

/**
 * Component to display syntax errors when a file cannot be parsed
 */
const SyntaxErrorsDisplay: React.FC<SyntaxErrorsDisplayProps> = ({ errors, filePath }) => {
  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Alert severity="error" sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Syntax Errors Detected
        </Typography>
        <Typography variant="body2">
          This file contains syntax errors and cannot be edited until they are fixed.
          Please correct the errors in a text editor and reload the file.
        </Typography>
      </Alert>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Error Details:
        </Typography>
        <List>
          {errors.map((error, index) => (
            <ListItem
              key={index}
              sx={{
                flexDirection: 'column',
                alignItems: 'flex-start',
                borderBottom: '1px solid',
                borderColor: 'divider'
              }}
            >
              <ListItemText
                primary={error.message}
                secondary={
                  <>
                    <Typography component="span" variant="body2" color="text.secondary">
                      Type: {error.type}
                    </Typography>
                    {error.position && (
                      <>
                        <br />
                        <Typography component="span" variant="body2" color="text.secondary">
                          Location: Line {error.position.row}, Column {error.position.column}
                        </Typography>
                      </>
                    )}
                    {error.text && (
                      <>
                        <br />
                        <Typography
                          component="span"
                          variant="body2"
                          color="error"
                          sx={{ fontFamily: 'monospace', mt: 1, display: 'block' }}
                        >
                          {error.text}
                        </Typography>
                      </>
                    )}
                  </>
                }
              />
            </ListItem>
          ))}
        </List>
      </Paper>

      <Box sx={{ mt: 3 }}>
        <Typography variant="body2" color="text.secondary">
          File path: {filePath}
        </Typography>
      </Box>
    </Box>
  );
};

export default SyntaxErrorsDisplay;
