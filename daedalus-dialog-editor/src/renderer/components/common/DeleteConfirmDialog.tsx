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
 * Auto-focuses Cancel: the dialog is opened by Escape, so Escape-then-Enter
 * must back out, not delete. Delete stays one Tab away.
 */
const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  title = 'Delete action',
  message = 'Are you sure you want to delete this action?'
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      // Focus Cancel after the dialog opens so Enter backs out
      const timer = setTimeout(() => cancelRef.current?.focus(), 0);
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
        <Button ref={cancelRef} onClick={onCancel} size="small">
          Cancel
        </Button>
        <Button
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
