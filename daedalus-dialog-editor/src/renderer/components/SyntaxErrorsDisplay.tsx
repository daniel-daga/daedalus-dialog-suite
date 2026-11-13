import React from 'react';
import { Box, Typography, Alert, Paper, List, ListItem, ListItemText, Stack } from '@mui/material';
import ScriptFileActions from './ScriptFileActions';
import type { ParseError } from '../types/global';
import { useEditorStore } from '../store/editorStore';

interface SyntaxErrorsDisplayProps {
  errors: ParseError[];
  filePath: string | null;
  onReload?: () => Promise<void>;
}

const SyntaxErrorsDisplay: React.FC<SyntaxErrorsDisplayProps> = ({ errors, filePath, onReload }) => {
  const reloadFile = useEditorStore((s) => s.reloadFile);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, height: '100%', overflow: 'auto', boxSizing: 'border-box' }}>
      <Stack spacing={2} sx={{ maxWidth: 1000, mx: 'auto' }}>
        <Box>
          <Typography variant="h5" component="h1">{filePath?.split(/[\\/]/).pop() || 'Script file'}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{filePath}</Typography>
        </Box>
        <Alert severity="error">
          Visual editing is unavailable because this file contains parse errors. Edit the original file in a text editor,
          save it there, then reload it here. The file has not been changed.
        </Alert>
        <ScriptFileActions filePath={filePath} onReload={async () => {
          if (filePath) await (onReload ? onReload() : reloadFile(filePath));
        }} />
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2">Parse errors ({errors.length})</Typography>
          <List disablePadding>
            {errors.map((error, index) => (
              <ListItem key={index} disableGutters sx={{ borderBottom: index < errors.length - 1 ? 1 : 0, borderColor: 'divider' }}>
                <ListItemText
                  primary={error.message}
                  secondary={
                    <>
                      {error.position && <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
                        Line {error.position.row}, Column {error.position.column}
                      </Typography>}
                      {error.text && <Box component="code" sx={{ display: 'block', mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error.text}</Box>}
                    </>
                  }
                  sx={{ overflowWrap: 'anywhere' }}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      </Stack>
    </Box>
  );
};

export default SyntaxErrorsDisplay;
