import React from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Table, TableBody, TableCell, TableRow, Typography,
} from '@mui/material';
import { KEYBOARD_SHORTCUTS, SHORTCUT_GROUPS } from './keyboardShortcuts';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const KeyboardShortcutsDialog: React.FC<KeyboardShortcutsDialogProps> = ({ open, onClose }) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="keyboard-shortcuts-title">
    <DialogTitle id="keyboard-shortcuts-title">Keyboard shortcuts</DialogTitle>
    <DialogContent dividers>
      {SHORTCUT_GROUPS.map((group) => (
        <Box key={group} sx={{ mb: 2, '&:last-of-type': { mb: 0 } }}>
          <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>{group}</Typography>
          <Table size="small">
            <TableBody>
              {KEYBOARD_SHORTCUTS.filter((row) => row.group === group).map((row) => (
                <TableRow key={`${row.keys} ${row.action}`}>
                  <TableCell sx={{ width: '40%', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    {row.keys}
                  </TableCell>
                  <TableCell>{row.action}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ))}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Close</Button>
    </DialogActions>
  </Dialog>
);

export default KeyboardShortcutsDialog;
