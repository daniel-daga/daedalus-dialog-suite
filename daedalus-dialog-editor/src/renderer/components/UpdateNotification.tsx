import React, { useState, useEffect, useCallback } from 'react';
import {
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  LinearProgress,
  Link,
} from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import { UpdateCheckResult } from '../types/global';

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'update-available'; result: UpdateCheckResult }
  | { kind: 'downloading'; percent: number; result: UpdateCheckResult }
  | { kind: 'ready-to-install'; installerPath: string; result: UpdateCheckResult }
  | { kind: 'installing' }
  | { kind: 'error'; message: string };

interface UpdateNotificationProps {
  /** Called by App on startup to trigger the initial check */
  triggerCheck?: boolean;
}

const UpdateNotification: React.FC<UpdateNotificationProps> = ({ triggerCheck }) => {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  const [dialogOpen, setDialogOpen] = useState(false);

  const runCheck = useCallback(async () => {
    setState({ kind: 'checking' });
    try {
      const result = await window.editorAPI.checkForUpdate();
      if (result.updateAvailable) {
        setState({ kind: 'update-available', result });
      } else {
        setState({ kind: 'up-to-date' });
      }
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  }, []);

  // Respond to external trigger (startup auto-check)
  useEffect(() => {
    if (triggerCheck) {
      void runCheck();
    }
  }, [triggerCheck, runCheck]);

  // Listen for download progress from main process
  useEffect(() => {
    const unsubscribe = window.editorAPI.onDownloadProgress((percent) => {
      setState((prev) => {
        if (prev.kind === 'downloading') {
          return { ...prev, percent };
        }
        return prev;
      });
    });
    return unsubscribe;
  }, []);

  const handleDownloadAndInstall = async () => {
    if (state.kind !== 'update-available') return;
    const { result } = state;
    if (!result.downloadUrl) return;

    setState({ kind: 'downloading', percent: 0, result });
    try {
      const installerPath = await window.editorAPI.downloadUpdate(result.downloadUrl);
      setState({ kind: 'ready-to-install', installerPath, result });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Download failed' });
    }
  };

  const handleInstall = async () => {
    if (state.kind !== 'ready-to-install') return;
    setState({ kind: 'installing' });
    try {
      await window.editorAPI.installUpdate(state.installerPath);
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Install failed' });
    }
  };

  const handleDismiss = () => {
    setDialogOpen(false);
    setState({ kind: 'idle' });
  };

  // Only show chip when an update is available or we're in a post-check state
  const showChip =
    state.kind === 'update-available' ||
    state.kind === 'downloading' ||
    state.kind === 'ready-to-install' ||
    state.kind === 'installing' ||
    state.kind === 'error';

  const chipLabel = (() => {
    switch (state.kind) {
      case 'update-available':
        return `Update available: ${state.result.latestVersion}`;
      case 'downloading':
        return `Downloading... ${state.percent}%`;
      case 'ready-to-install':
        return 'Ready to install';
      case 'installing':
        return 'Installing...';
      case 'error':
        return 'Update error';
      default:
        return '';
    }
  })();

  return (
    <>
      {showChip && (
        <Chip
          icon={<SystemUpdateAltIcon sx={{ color: 'white !important' }} />}
          label={chipLabel}
          size="small"
          color={state.kind === 'error' ? 'error' : 'success'}
          onClick={() => setDialogOpen(true)}
          sx={{ mr: 2, color: 'white', cursor: 'pointer' }}
        />
      )}

      <Dialog open={dialogOpen} onClose={handleDismiss} maxWidth="sm" fullWidth>
        <DialogTitle>Software Update</DialogTitle>
        <DialogContent>
          {(state.kind === 'update-available' || state.kind === 'downloading' || state.kind === 'ready-to-install' || state.kind === 'installing') && (
            <>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Current version
                </Typography>
                <Typography variant="body1">
                  {state.result.currentVersion}
                </Typography>
              </Box>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Available version
                </Typography>
                <Typography variant="body1" color="success.main" fontWeight="medium">
                  {state.result.latestVersion}
                </Typography>
              </Box>
              {state.result.releaseUrl && (
                <Box sx={{ mb: 2 }}>
                  <Link href="#" onClick={(e) => { e.preventDefault(); /* open via shell */ }} underline="hover">
                    View release notes
                  </Link>
                </Box>
              )}
            </>
          )}

          {state.kind === 'downloading' && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" gutterBottom>
                Downloading update... {state.percent}%
              </Typography>
              <LinearProgress variant="determinate" value={state.percent} />
            </Box>
          )}

          {state.kind === 'ready-to-install' && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="success.main">
                Download complete. Click "Install & Restart" to apply the update. The app will close and the installer will run silently.
              </Typography>
            </Box>
          )}

          {state.kind === 'installing' && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2">Installing update, the application will close...</Typography>
              <LinearProgress sx={{ mt: 1 }} />
            </Box>
          )}

          {state.kind === 'error' && (
            <Typography variant="body2" color="error">
              {state.message}
            </Typography>
          )}
        </DialogContent>

        <DialogActions>
          {state.kind === 'update-available' && (
            <>
              <Button onClick={handleDismiss}>Remind Me Later</Button>
              <Button variant="contained" onClick={() => void handleDownloadAndInstall()}>
                Download &amp; Install
              </Button>
            </>
          )}
          {state.kind === 'downloading' && (
            <Button disabled>Downloading...</Button>
          )}
          {state.kind === 'ready-to-install' && (
            <>
              <Button onClick={handleDismiss}>Later</Button>
              <Button variant="contained" color="success" onClick={() => void handleInstall()}>
                Install &amp; Restart
              </Button>
            </>
          )}
          {state.kind === 'installing' && (
            <Button disabled>Installing...</Button>
          )}
          {state.kind === 'error' && (
            <Button onClick={handleDismiss}>Close</Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};

export default UpdateNotification;
