import React, { useState } from 'react';
import { Box, Typography, Alert, Paper, List, ListItem, ListItemText, Button, Stack } from '@mui/material';
import { OpenInNew, Refresh } from '@mui/icons-material';
import type { ParseError } from '../types/global';
import { useEditorStore } from '../store/editorStore';

interface SyntaxErrorsDisplayProps {
  errors: ParseError[];
  filePath: string | null;
}

const SyntaxErrorsDisplay: React.FC<SyntaxErrorsDisplayProps> = ({ errors, filePath }) => {
  const reloadFile = useEditorStore((s) => s.reloadFile);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null);
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

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
        <Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button variant="contained" startIcon={<OpenInNew />} disabled={!filePath || busy}
              onClick={() => filePath && void runAction(() => window.editorAPI.openScriptInExternalEditor(filePath))}>
              Edit externally
            </Button>
            <Button variant="outlined" startIcon={<Refresh />} disabled={!filePath || busy}
              onClick={() => filePath && void runAction(() => reloadFile(filePath))}>
              Reload file
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Opens the default application for .d files. Set your text editor as the default in your system settings.
          </Typography>
        </Box>
        {actionError && <Alert severity="error">{actionError}</Alert>}
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
