import React, { useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button
} from '@mui/material';

export interface DeleteConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  message?: string;
}

/**
 * Reusable confirmation dialog for delete operations.
 * Auto-focuses the confirm button so Enter confirms immediately.
 */
const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  title = 'Delete action',
  message = 'Are you sure you want to delete this action?'
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      // Focus the confirm button after the dialog opens so Enter confirms
      const timer = setTimeout(() => confirmRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      aria-labelledby="delete-confirm-title"
    >
      <DialogTitle id="delete-confirm-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} size="small">
          Cancel
        </Button>
        <Button
          ref={confirmRef}
          onClick={onConfirm}
          color="error"
          variant="contained"
          size="small"
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DeleteConfirmDialog;
