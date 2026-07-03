import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from '@mui/material';
import { useFileStore } from '../store/fileStore';

const basename = (filePath: string): string =>
  filePath.split(/[\\/]/).pop() || filePath;

/**
 * External-change conflict resolution dialog (E4). Auto-opens for the active
 * file when it changed on disk (or was deleted — the `fileMissing` variant)
 * while the editor holds unsaved changes. Background-file conflicts surface as
 * an app-bar chip (App.tsx); activating that file brings up this dialog.
 *
 * Resolution is delegated to the store's `resolveExternalConflict`:
 *   - keepMine     → overwrite disk with the editor's content
 *   - reloadTheirs → discard the editor's changes (reload, or close if deleted)
 */
const ExternalChangeConflictDialog: React.FC = () => {
  const activeFile = useFileStore((s) => s.activeFile);
  const openFiles = useFileStore((s) => s.openFiles);
  const resolveExternalConflict = useFileStore((s) => s.resolveExternalConflict);

  const [resolving, setResolving] = useState(false);

  const activeFileState = activeFile ? openFiles.get(activeFile) : undefined;
  const conflict = activeFileState?.externalConflict;
  const open = !!activeFile && !!conflict;
  const fileMissing = !!conflict?.fileMissing;

  const resolve = async (resolution: 'keepMine' | 'reloadTheirs') => {
    if (!activeFile) {
      return;
    }
    setResolving(true);
    try {
      await resolveExternalConflict(activeFile, resolution);
    } finally {
      setResolving(false);
    }
  };

  const fileName = activeFile ? basename(activeFile) : '';

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      data-testid="external-conflict-dialog"
      aria-labelledby="external-conflict-title"
    >
      <DialogTitle id="external-conflict-title">
        {fileMissing ? 'File deleted on disk' : 'File changed on disk'}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          {fileMissing
            ? `${fileName} was deleted or moved on disk while you have unsaved changes.`
            : `${fileName} changed on disk while you have unsaved changes.`}
        </Typography>
      </DialogContent>
      <DialogActions>
        {fileMissing ? (
          <>
            <Button
              onClick={() => void resolve('reloadTheirs')}
              size="small"
              color="inherit"
              disabled={resolving}
              data-testid="external-conflict-discard"
            >
              Discard
            </Button>
            <Button
              onClick={() => void resolve('keepMine')}
              variant="contained"
              size="small"
              disabled={resolving}
              data-testid="external-conflict-keep-mine"
            >
              Restore file (write my version back)
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => void resolve('reloadTheirs')}
              size="small"
              color="inherit"
              disabled={resolving}
              data-testid="external-conflict-reload"
            >
              Reload from disk (discard my changes)
            </Button>
            <Button
              onClick={() => void resolve('keepMine')}
              variant="contained"
              size="small"
              disabled={resolving}
              data-testid="external-conflict-keep-mine"
            >
              Keep mine (overwrite disk)
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ExternalChangeConflictDialog;
