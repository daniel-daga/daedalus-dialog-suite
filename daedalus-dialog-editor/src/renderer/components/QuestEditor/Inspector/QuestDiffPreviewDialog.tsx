import React from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography
} from '@mui/material';
import CodeDiffView from '../../common/CodeDiffView';

interface QuestDiffPreviewDialogProps {
  open: boolean;
  beforeCode: string;
  afterCode: string;
  fileDiffs?: Array<{
    filePath: string;
    beforeCode: string;
    afterCode: string;
  }>;
  onClose: () => void;
  onApply: () => void;
  isApplying: boolean;
  warnings?: Array<{
    message: string;
    blocking?: boolean;
  }>;
}

const QuestDiffPreviewDialog: React.FC<QuestDiffPreviewDialogProps> = ({
  open,
  beforeCode,
  afterCode,
  fileDiffs = [],
  onClose,
  onApply,
  isApplying,
  warnings = []
}) => {
  const hasFileDiffs = fileDiffs.length > 0;
  const hasBlockingWarnings = warnings.some((warning) => warning.blocking);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Quest Command Diff Preview</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Review the generated script changes before applying them.
          </Typography>
          {warnings.map((warning, index) => (
            <Alert
              key={`${index}-${warning.message}`}
              severity={warning.blocking ? 'error' : 'warning'}
            >
              {warning.message}
            </Alert>
          ))}
          {hasFileDiffs ? fileDiffs.map((entry) => (
            <Stack key={entry.filePath} spacing={0.5}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {entry.filePath}
              </Typography>
              <CodeDiffView
                beforeCode={entry.beforeCode}
                afterCode={entry.afterCode}
                maxHeight={240}
              />
            </Stack>
          )) : (
            <CodeDiffView beforeCode={beforeCode} afterCode={afterCode} maxHeight={480} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isApplying}>Cancel</Button>
        <Button variant="contained" onClick={onApply} disabled={isApplying || hasBlockingWarnings}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default QuestDiffPreviewDialog;
