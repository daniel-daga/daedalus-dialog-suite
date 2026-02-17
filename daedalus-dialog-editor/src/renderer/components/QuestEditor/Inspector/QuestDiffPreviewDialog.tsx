import React, { useMemo } from 'react';
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

const buildLineDiff = (beforeCode: string, afterCode: string): string => {
  const beforeLines = beforeCode.split('\n');
  const afterLines = afterCode.split('\n');
  const max = Math.max(beforeLines.length, afterLines.length);
  const output: string[] = [];

  for (let index = 0; index < max; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      output.push(` ${beforeLine ?? ''}`);
      continue;
    }
    if (beforeLine !== undefined) {
      output.push(`-${beforeLine}`);
    }
    if (afterLine !== undefined) {
      output.push(`+${afterLine}`);
    }
  }

  return output.join('\n');
};

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
  const preview = useMemo(() => buildLineDiff(beforeCode, afterCode), [beforeCode, afterCode]);
  const previewsByFile = useMemo(() => (
    fileDiffs.map((entry) => ({
      filePath: entry.filePath,
      preview: buildLineDiff(entry.beforeCode, entry.afterCode)
    }))
  ), [fileDiffs]);
  const hasFileDiffs = previewsByFile.length > 0;
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
          {hasFileDiffs ? previewsByFile.map((entry) => (
            <Stack key={entry.filePath} spacing={0.5}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {entry.filePath}
              </Typography>
              <Typography
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: '#111',
                  color: '#ddd',
                  maxHeight: 240,
                  overflow: 'auto',
                  fontFamily: 'Consolas, Monaco, monospace',
                  fontSize: 12,
                  lineHeight: 1.4
                }}
              >
                {entry.preview}
              </Typography>
            </Stack>
          )) : (
            <Typography
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                borderRadius: 1,
                bgcolor: '#111',
                color: '#ddd',
                maxHeight: 480,
                overflow: 'auto',
                fontFamily: 'Consolas, Monaco, monospace',
                fontSize: 12,
                lineHeight: 1.4
              }}
            >
              {preview}
            </Typography>
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
