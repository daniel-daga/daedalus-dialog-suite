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
  IconButton,
  LinearProgress,
  Tooltip
} from '@mui/material';
import { Close as CloseIcon, CheckCircle as CheckCircleIcon, Error as ErrorIcon } from '@mui/icons-material';
import { useProjectStore, ParsedFileCache } from '../store/projectStore';

interface IngestedFilesDialogProps {
  open: boolean;
  onClose: () => void;
}

export const IngestedFilesDialog: React.FC<IngestedFilesDialogProps> = ({ open, onClose }) => {
  const { parsedFiles, allDialogFiles, isIngesting } = useProjectStore((state) => ({
    parsedFiles: state.parsedFiles,
    allDialogFiles: state.allDialogFiles,
    isIngesting: state.isIngesting
  }));

  if (!open || !allDialogFiles || !parsedFiles) {
    return null;
  }

  // Merge all known files with their parsed status
  const fileList = (allDialogFiles || []).map(filePath => {
    // Safely handle both Map and plain object
    const parsed = (parsedFiles && typeof (parsedFiles as any).get === 'function')
      ? (parsedFiles as any).get(filePath) 
      : (parsedFiles as any)?.[filePath];
      
    return {
      filePath,
      isParsed: !!parsed,
      hasErrors: parsed?.semanticModel?.hasErrors || false,
      errors: parsed?.semanticModel?.errors || [],
      errorCount: parsed?.semanticModel?.errors?.length || 0,
      lastParsed: parsed?.lastParsed
    };
  });

  // Sort: Errors first, then Parsed, then Pending, then Alphabetical
  fileList.sort((a, b) => {
    const getPriority = (f: any) => {
      if (!f) return 3;
      if (f.hasErrors) return 0; // Highest priority
      if (f.isParsed) return 1;  // Second priority
      return 2;                  // Lowest priority (Pending)
    };

    const priorityA = getPriority(a);
    const priorityB = getPriority(b);

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    return (a?.filePath || '').localeCompare(b?.filePath || '');
  });

  const parsedCount = fileList.filter(f => f.isParsed).length;
  const progress = allDialogFiles.length > 0 ? (parsedCount / allDialogFiles.length) * 100 : 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" flexDirection="column" gap={1}>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            Project Files ({fileList.length})
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
          {isIngesting && (
            <Box sx={{ width: '100%' }}>
              <LinearProgress variant="determinate" value={progress} />
              <Typography variant="caption" color="text.secondary">
                Ingesting... {parsedCount} / {allDialogFiles.length}
              </Typography>
            </Box>
          )}
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {fileList.length === 0 ? (
          <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
            No files found in project.
          </Typography>
        ) : (
          <List>
            {fileList.map((file) => (
              <ListItem key={file.filePath} divider>
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body1" component="span" sx={{ wordBreak: 'break-all' }}>
                        {file.filePath}
                      </Typography>
                      {file.isParsed ? (
                        file.hasErrors ? (
                           <Tooltip title={
                             <Box sx={{ p: 0.5 }}>
                               {file.errors.slice(0, 10).map((e, i) => (
                                 <Typography key={i} variant="caption" display="block" sx={{ whiteSpace: 'pre-wrap', mb: 0.5 }}>
                                   {e.message}
                                 </Typography>
                               ))}
                               {file.errors.length > 10 && (
                                 <Typography variant="caption" display="block" fontStyle="italic">
                                   ...and {file.errors.length - 10} more
                                 </Typography>
                               )}
                             </Box>
                           }>
                             <Chip
                               icon={<ErrorIcon />}
                               label={`${file.errorCount} Errors`}
                               color="error"
                               size="small"
                             />
                           </Tooltip>
                        ) : (
                          <Chip
                            icon={<CheckCircleIcon />}
                            label="Parsed"
                            color="success"
                            size="small"
                            variant="outlined"
                          />
                        )
                      ) : (
                        <Chip
                          label="Pending"
                          size="small"
                          variant="outlined"
                          sx={{ opacity: 0.6 }}
                        />
                      )}
                    </Box>
                  }
                  secondary={file.isParsed && file.lastParsed ? `Last parsed: ${file.lastParsed.toLocaleTimeString()}` : 'Not loaded yet'}
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
