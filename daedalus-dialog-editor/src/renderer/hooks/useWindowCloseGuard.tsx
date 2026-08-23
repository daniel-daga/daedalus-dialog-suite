import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
} from '@mui/material';
import {
  useFileStore,
  hasUnsavedChanges,
  isSourceDirty,
  type FileState,
} from '../store/fileStore';
import { flushAllPendingEdits } from '../utils/pendingEditFlushRegistry';
import { classifySaveError, describeSaveError } from '../utils/saveError';

const basename = (filePath: string): string =>
  filePath.split(/[\\/]/).pop() || filePath;

interface CloseFailure {
  filePath: string;
  message: string;
}

/**
 * Window-close guard (E1). Renders the confirm/save dialog when the main
 * process asks the renderer to close with unsaved work. Mounted once in App;
 * returns the dialog element (or null when idle) for the caller to render.
 *
 * Flow on `closeRequested`:
 *   1. Acknowledge immediately so the main-process force-close safety timer is
 *      cancelled (the timer only guards a hung/crashed renderer, never a user
 *      still deciding).
 *   2. Flush pending debounced edits (N4) so a keystroke still in a 300 ms
 *      debounce counts toward the unsaved set.
 *   3. Compute the unsaved set (`hasUnsavedChanges`). Empty → approve the close.
 *      Otherwise open the dialog.
 */
export function useWindowCloseGuard(): React.ReactElement | null {
  // The set of file paths captured when the close was requested. `null` means
  // the dialog is closed (idle).
  const [pendingPaths, setPendingPaths] = useState<string[] | null>(null);
  // §3 P1: subscribe to `openFiles` only while the dialog is showing — while
  // idle (the common case) the selector yields a constant `null`, so edit
  // flushes (which give the Map a fresh identity) do not re-render the host
  // component (App). The open dialog still tracks live file states.
  const openFiles = useFileStore((s) => (pendingPaths ? s.openFiles : null));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CloseFailure | null>(null);

  useEffect(() => {
    const unsubscribe = window.editorAPI.onCloseRequested(() => {
      window.editorAPI.ackCloseRequest();
      flushAllPendingEdits();

      const files = useFileStore.getState().openFiles;
      const unsaved = Array.from(files.values())
        .filter(hasUnsavedChanges)
        .map((fs) => fs.filePath);

      if (unsaved.length === 0) {
        window.editorAPI.approveClose();
        setPendingPaths(null);
        return;
      }

      setFailure(null);
      setPendingPaths(unsaved);
    });
    return unsubscribe;
  }, []);

  const describeError = useCallback((error: unknown): string => {
    const saveError = classifySaveError(error);
    if (saveError) {
      return describeSaveError(saveError);
    }
    return error instanceof Error ? error.message : 'Save failed.';
  }, []);

  const resolveConflict = useCallback(
    async (filePath: string, resolution: 'keepMine' | 'reloadTheirs') => {
      setBusy(true);
      setFailure(null);
      try {
        await useFileStore.getState().resolveExternalConflict(filePath, resolution);
      } catch (error) {
        setFailure({ filePath, message: describeError(error) });
      } finally {
        setBusy(false);
      }
    },
    [describeError]
  );

  const handleSaveAndClose = useCallback(async () => {
    if (!pendingPaths) {
      return;
    }
    setBusy(true);
    setFailure(null);

    let currentPath = '';
    try {
      const store = useFileStore.getState();
      for (const filePath of pendingPaths) {
        currentPath = filePath;
        const fileState = store.openFiles.get(filePath);
        if (!fileState) {
          continue;
        }

        // An unresolved external conflict must be settled first (Keep mine /
        // Discard) — the button is disabled while any remain, but guard anyway.
        if (fileState.externalConflict) {
          setFailure({
            filePath,
            message: 'This file changed on disk — resolve the conflict (Keep mine / Discard) before saving.',
          });
          setBusy(false);
          return;
        }

        if (isSourceDirty(fileState)) {
          // Source-dirty: persist the typed source. saveSource throws on failure.
          await store.saveSource(filePath, fileState.workingCode as string);
        } else if (fileState.isDirty) {
          const result = await store.saveFile(filePath);
          if (!result.success) {
            // A validation failure returns without throwing; a classifiable
            // rejection already threw and is handled below. Either way, never
            // approve the close on a failed save.
            const current = useFileStore.getState().openFiles.get(filePath);
            const message = current?.saveError
              ? describeSaveError(current.saveError)
              : 'Save failed: validation errors prevented saving this file. Your changes are kept in the editor.';
            setFailure({ filePath, message });
            setBusy(false);
            return;
          }
        }
      }

      window.editorAPI.approveClose();
      setPendingPaths(null);
    } catch (error) {
      setFailure({ filePath: currentPath, message: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [pendingPaths, describeError]);

  const handleCloseWithoutSaving = useCallback(() => {
    window.editorAPI.approveClose();
    setPendingPaths(null);
  }, []);

  const handleCancel = useCallback(() => {
    window.editorAPI.cancelClose();
    setPendingPaths(null);
  }, []);

  if (pendingPaths === null) {
    return null;
  }

  // Render live file states so a conflict resolution (which mutates the store)
  // updates the dialog immediately. (`openFiles` is non-null whenever
  // `pendingPaths` is set — the selector above keys on it.)
  const liveStates = pendingPaths
    .map((filePath) => openFiles?.get(filePath))
    .filter((fs): fs is FileState => !!fs);

  const conflictedFiles = liveStates.filter((fs) => fs.externalConflict);
  const hasConflicts = conflictedFiles.length > 0;

  return (
    <Dialog
      open
      maxWidth="sm"
      fullWidth
      data-testid="close-guard-dialog"
      aria-labelledby="close-guard-title"
    >
      <DialogTitle id="close-guard-title">Unsaved changes</DialogTitle>
      <DialogContent>
        <DialogContentText>
          You have unsaved changes in the following file{liveStates.length === 1 ? '' : 's'}:
        </DialogContentText>
        <List dense>
          {liveStates.map((fs) => (
            <ListItem
              key={fs.filePath}
              disableGutters
              secondaryAction={
                fs.externalConflict ? (
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      color="inherit"
                      disabled={busy}
                      onClick={() => void resolveConflict(fs.filePath, 'reloadTheirs')}
                      data-testid="close-guard-conflict-discard"
                    >
                      Discard
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={busy}
                      onClick={() => void resolveConflict(fs.filePath, 'keepMine')}
                      data-testid="close-guard-conflict-keep-mine"
                    >
                      Keep mine
                    </Button>
                  </Stack>
                ) : undefined
              }
            >
              <ListItemText
                primary={basename(fs.filePath)}
                secondary={
                  fs.externalConflict
                    ? 'Changed on disk — resolve before saving'
                    : isSourceDirty(fs)
                      ? 'Unsaved source edits'
                      : 'Unsaved changes'
                }
              />
            </ListItem>
          ))}
        </List>
        {hasConflicts && (
          <Alert severity="warning" sx={{ mt: 1 }} data-testid="close-guard-conflict-hint">
            Resolve the on-disk conflicts above before saving and closing.
          </Alert>
        )}
        {failure && (
          <Alert severity="error" sx={{ mt: 1 }} data-testid="close-guard-error">
            {basename(failure.filePath)}: {failure.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={handleCancel}
          disabled={busy}
          color="inherit"
          data-testid="close-guard-cancel"
        >
          Cancel
        </Button>
        <Button
          onClick={handleCloseWithoutSaving}
          disabled={busy}
          color="error"
          data-testid="close-guard-discard"
        >
          Close without saving
        </Button>
        <Button
          onClick={() => void handleSaveAndClose()}
          disabled={busy || hasConflicts}
          variant="contained"
          data-testid="close-guard-save"
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Save and close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
