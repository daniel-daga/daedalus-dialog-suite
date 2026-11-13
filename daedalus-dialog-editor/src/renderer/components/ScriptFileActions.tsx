import React, { useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { OpenInNew, Refresh } from '@mui/icons-material';

interface ScriptFileActionsProps {
  filePath: string | null;
  onReload: () => Promise<void>;
}

const ScriptFileActions: React.FC<ScriptFileActionsProps> = ({ filePath, onReload }) => {
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
    <Box>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<OpenInNew />} disabled={!filePath || busy}
          onClick={() => filePath && void runAction(() => window.editorAPI.openScriptInExternalEditor(filePath))}>
          Edit externally
        </Button>
        <Button variant="outlined" startIcon={<Refresh />} disabled={!filePath || busy}
          onClick={() => void runAction(onReload)}>
          Reload file
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Opens the default application for .d files. Set your text editor as the default in your system settings.
      </Typography>
      {actionError && <Alert severity="error" sx={{ mt: 1 }}>{actionError}</Alert>}
    </Box>
  );
};

export default ScriptFileActions;
