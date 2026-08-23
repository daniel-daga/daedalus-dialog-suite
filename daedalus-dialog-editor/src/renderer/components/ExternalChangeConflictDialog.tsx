import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
} from '@mui/material';
import { useFileStore } from '../store/fileStore';
import CodeDiffView from './common/CodeDiffView';

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
  // §3 P1: subscribe to the active file's entry, not the whole `openFiles` Map
  // (which gets a fresh identity on every edit flush to any open file).
  const activeFileState = useFileStore((s) =>
    s.activeFile ? s.openFiles.get(s.activeFile) : undefined
  );
  const resolveExternalConflict = useFileStore((s) => s.resolveExternalConflict);

  const [resolving, setResolving] = useState(false);
  const conflict = activeFileState?.externalConflict;
  const open = !!activeFile && !!conflict;
  const fileMissing = !!conflict?.fileMissing;

  // On-disk diff (feature-suggestions item 6): when the dialog opens for a
  // changed-on-disk conflict, load both sides so the user can see exactly what
  // differs before choosing a resolution. Any load failure falls back to the
  // text-only dialog — the diff is an aid, never a gate.
  const [diff, setDiff] = useState<{ disk: string; mine: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    if (!open || fileMissing || !activeFile) {
      setDiff(null);
      setDiffLoading(false);
      return;
    }

    let cancelled = false;
    setDiff(null);
    setDiffLoading(true);

    void (async () => {
      try {
        const state = useFileStore.getState();
        const fileState = state.openFiles.get(activeFile);
        if (!fileState) {
          return;
        }
        const disk = await window.editorAPI.readFile(activeFile);
        const mine = fileState.workingCode
          ?? await window.editorAPI.generateCode(fileState.semanticModel, state.codeSettings);
        if (!cancelled) {
          setDiff({ disk, mine });
        }
      } catch (error) {
        console.error('Failed to build on-disk conflict diff:', error);
      } finally {
        if (!cancelled) {
          setDiffLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [open, fileMissing, activeFile, conflict?.detectedAt]);

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
        {!fileMissing && diffLoading && (
          <Box
            sx={{ display: 'flex', justifyContent: 'center', py: 2 }}
            data-testid="external-conflict-diff-loading"
          >
            <CircularProgress size={24} />
          </Box>
        )}
        {!fileMissing && diff && (
          <Box sx={{ mb: 1.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
              − version on disk · + your unsaved version
            </Typography>
            <CodeDiffView
              beforeCode={diff.disk}
              afterCode={diff.mine}
              maxHeight={320}
              data-testid="external-conflict-diff"
            />
          </Box>
        )}
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
