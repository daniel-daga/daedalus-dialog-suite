import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  List,
  ListItem,
  ListItemText,
  Alert,
  Box,
  TextField,
} from '@mui/material';
import { Warning as WarningIcon } from '@mui/icons-material';

export interface FunctionRenameEntry {
  oldName: string;
  newName: string;
}

export interface RenameDialogConfirmProps {
  open: boolean;
  oldDialogName: string;
  newDialogName: string;
  /** Validation error message — if set, the Rename button is disabled */
  validationError?: string;
  /** Functions that will be renamed as part of the cascade */
  functionRenames: FunctionRenameEntry[];
  /** Files (not current file) that have NpcKnowsInfo references to this dialog */
  crossFileWarnings: string[];
  onConfirm: () => void;
  onCancel: () => void;
  /** Called when the new name input changes — allows parent to re-validate */
  onNewNameChange?: (name: string) => void;
}

/**
 * Confirmation dialog for renaming a dialog instance.
 * Shows function cascade renames and cross-file reference warnings.
 */
const RenameDialogConfirmDialog: React.FC<RenameDialogConfirmProps> = ({
  open,
  oldDialogName,
  newDialogName,
  validationError,
  functionRenames,
  crossFileWarnings,
  onConfirm,
  onCancel,
  onNewNameChange,
}) => {
  const hasCrossFileWarnings = crossFileWarnings.length > 0;
  const hasFunctionRenames = functionRenames.length > 0;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Rename Dialog</DialogTitle>
      <DialogContent>
        <Typography variant="body2" gutterBottom>
          <strong>{oldDialogName}</strong> → <strong>{newDialogName || '…'}</strong>
        </Typography>

        {onNewNameChange && (
          <TextField
            autoFocus
            margin="dense"
            fullWidth
            label="New Name"
            value={newDialogName}
            onChange={(e) => onNewNameChange(e.target.value)}
            error={!!validationError}
            helperText={validationError}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !validationError && newDialogName.trim()) {
                e.preventDefault();
                onConfirm();
              }
            }}
          />
        )}

        {hasFunctionRenames && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              The following functions will also be renamed:
            </Typography>
            <List dense disablePadding>
              {functionRenames.map((entry) => (
                <ListItem key={entry.oldName} disablePadding sx={{ pl: 1 }}>
                  <ListItemText
                    primary={`${entry.oldName} → ${entry.newName}`}
                    primaryTypographyProps={{ variant: 'caption', fontFamily: 'monospace' }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {hasCrossFileWarnings && (
          <Alert severity="warning" icon={<WarningIcon fontSize="small" />} sx={{ mt: 1.5 }}>
            <Typography variant="caption" display="block" gutterBottom>
              References in the following files will need manual update:
            </Typography>
            <List dense disablePadding>
              {crossFileWarnings.map((filePath) => (
                <ListItem key={filePath} disablePadding sx={{ pl: 1 }}>
                  <ListItemText
                    primary={filePath}
                    primaryTypographyProps={{ variant: 'caption', fontFamily: 'monospace' }}
                  />
                </ListItem>
              ))}
            </List>
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} size="small">
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          size="small"
          disabled={!!validationError || !newDialogName.trim()}
        >
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RenameDialogConfirmDialog;
