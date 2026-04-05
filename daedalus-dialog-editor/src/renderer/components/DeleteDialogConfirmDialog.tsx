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
} from '@mui/material';
import { Warning as WarningIcon } from '@mui/icons-material';

export interface DeleteDialogConfirmProps {
  open: boolean;
  dialogName: string;
  description?: string;
  /** Functions that will be deleted alongside the dialog */
  functionsToDelete: string[];
  /** Functions from other dialogs that reference this dialog via NpcKnowsInfo */
  brokenReferences: Array<{ functionName: string }>;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog for deleting a dialog instance.
 * Shows affected functions and any broken cross-references.
 */
const DeleteDialogConfirmDialog: React.FC<DeleteDialogConfirmProps> = ({
  open,
  dialogName,
  description,
  functionsToDelete,
  brokenReferences,
  onConfirm,
  onCancel,
}) => {
  const hasBrokenRefs = brokenReferences.length > 0;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Delete Dialog</DialogTitle>
      <DialogContent>
        <Typography variant="body2" gutterBottom>
          Delete <strong>{dialogName}</strong>
          {description ? ` — "${description}"` : ''}?
        </Typography>

        {functionsToDelete.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              The following functions will also be deleted:
            </Typography>
            <List dense disablePadding>
              {functionsToDelete.map((name) => (
                <ListItem key={name} disablePadding sx={{ pl: 1 }}>
                  <ListItemText
                    primary={name}
                    primaryTypographyProps={{ variant: 'caption', fontFamily: 'monospace' }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {hasBrokenRefs && (
          <Alert severity="warning" icon={<WarningIcon fontSize="small" />} sx={{ mt: 1.5 }}>
            <Typography variant="caption" display="block" gutterBottom>
              The following functions reference this dialog via{' '}
              <code>Npc_KnowsInfo</code> and will have broken references:
            </Typography>
            <List dense disablePadding>
              {brokenReferences.map((ref) => (
                <ListItem key={ref.functionName} disablePadding sx={{ pl: 1 }}>
                  <ListItemText
                    primary={ref.functionName}
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
        <Button onClick={onConfirm} color="error" variant="contained" size="small">
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DeleteDialogConfirmDialog;
