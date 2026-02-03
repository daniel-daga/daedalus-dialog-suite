import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  Typography,
  Chip,
  Box,
  IconButton
} from '@mui/material';
import { Close as CloseIcon, CheckCircle as CheckCircleIcon, Error as ErrorIcon } from '@mui/icons-material';
import { useProjectStore, ParsedFileCache } from '../store/projectStore';

interface IngestedFilesDialogProps {
  open: boolean;
  onClose: () => void;
}

export const IngestedFilesDialog: React.FC<IngestedFilesDialogProps> = ({ open, onClose }) => {
  const parsedFiles = useProjectStore((state) => state.parsedFiles);
  const files = Array.from(parsedFiles.values()).sort((a, b) => b.lastParsed.getTime() - a.lastParsed.getTime());

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          Ingested Files ({files.length})
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {files.length === 0 ? (
          <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
            No files ingested yet.
          </Typography>
        ) : (
          <List>
            {files.map((file: ParsedFileCache) => (
              <ListItem key={file.filePath} divider>
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body1" component="span" sx={{ wordBreak: 'break-all' }}>
                        {file.filePath}
                      </Typography>
                      {file.semanticModel.hasErrors ? (
                         <Chip
                           icon={<ErrorIcon />}
                           label={`${file.semanticModel.errors?.length || 0} Errors`}
                           color="error"
                           size="small"
                         />
                      ) : (
                        <Chip
                          icon={<CheckCircleIcon />}
                          label="OK"
                          color="success"
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Box>
                  }
                  secondary={`Last parsed: ${file.lastParsed.toLocaleTimeString()}`}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
