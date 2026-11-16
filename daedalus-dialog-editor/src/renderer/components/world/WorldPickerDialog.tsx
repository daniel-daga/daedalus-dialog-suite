import React from 'react';
import {
  Alert, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  List, ListItemButton, ListItemText, Stack, Typography,
} from '@mui/material';
import type { DiscoveredWorld } from '../../../shared/worldTypes';

/**
 * The worlds the project's own asset sources hold (level-editor.md §16.31).
 * A GMBT project already says where its worlds are, so opening one is a list
 * rather than a native file dialog seeded from a single install path.
 *
 * "Browse…" stays: the list is loose `.zen` files under the configured
 * sources, and a world somewhere else — or still packed in `Worlds.vdf`, which
 * nothing downstream can open anyway — is reached by hand.
 */
export interface WorldPickerListProps {
  worlds: DiscoveredWorld[];
  loading: boolean;
  error: string | null;
  onPick: (worldPath: string) => void;
  /** The rows' test ids. The idle surface shows this list too, and it is still
   *  on screen behind the dialog, so each caller names its own. */
  testIdPrefix?: string;
}

/** The list itself, shared by the dialog and the surface's empty state: with no
 *  world open the worlds are the useful thing on screen, not a button that
 *  opens a dialog holding the same list. */
export const WorldPickerList: React.FC<WorldPickerListProps> = ({
  worlds, loading, error, onPick, testIdPrefix = 'world-picker-entry',
}) => (
  <>
    {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
    {loading && (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
        <CircularProgress size={16} />
        <Typography variant="body2">Scanning the project&apos;s asset sources…</Typography>
      </Stack>
    )}
    {!loading && worlds.length === 0 && (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        No worlds under the project&apos;s asset sources. Add the folder that holds them in
        Asset sources, or browse for a `.zen` file.
      </Typography>
    )}
    {!loading && worlds.length > 0 && (
      <List aria-label="Worlds found in the project" dense>
        {worlds.map((world) => (
          <ListItemButton
            key={world.path}
            onClick={() => onPick(world.path)}
            data-testid={`${testIdPrefix}-${world.name}`}
          >
            <ListItemText
              primary={(
                <Stack direction="row" spacing={1} alignItems="center">
                  <span>{world.name}</span>
                  {world.isDefault && <Chip size="small" label="GMBT default" />}
                </Stack>
              )}
              secondary={world.source}
              secondaryTypographyProps={{ sx: { wordBreak: 'break-all' } }}
            />
          </ListItemButton>
        ))}
      </List>
    )}
  </>
);

export interface WorldPickerDialogProps {
  open: boolean;
  worlds: DiscoveredWorld[];
  loading: boolean;
  error: string | null;
  onPick: (worldPath: string) => void;
  onBrowse: () => void;
  onClose: () => void;
}

const WorldPickerDialog: React.FC<WorldPickerDialogProps> = ({
  open, worlds, loading, error, onPick, onBrowse, onClose,
}) => (
  <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="world-picker-title">
    <DialogTitle id="world-picker-title">Open world</DialogTitle>
    <DialogContent data-testid="world-picker">
      <WorldPickerList worlds={worlds} loading={loading} error={error} onPick={onPick} />
    </DialogContent>
    <DialogActions>
      <Button onClick={onBrowse} data-testid="world-picker-browse">Browse…</Button>
      <Button onClick={onClose}>Cancel</Button>
    </DialogActions>
  </Dialog>
);

export default WorldPickerDialog;
