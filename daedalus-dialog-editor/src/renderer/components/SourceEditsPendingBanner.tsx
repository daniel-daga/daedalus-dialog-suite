import React, { useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useFileStore, isSourceDirty } from '../store/fileStore';
import type { ParseError } from '../types/global';

interface SourceEditsPendingBannerProps {
  filePath: string | null;
}

/**
 * Reconciliation banner for source-dirty files (E2b). While the source buffer
 * (`workingCode`) differs from disk, model mutations are blocked (E2a) — this
 * banner is the UX to unblock:
 *   - Apply   → parse & adopt the source into the model (`adoptWorkingCode`);
 *               on parse errors, surface them and keep the banner + source.
 *   - Discard → drop the typed source (`setWorkingCode(fp, undefined)`).
 *
 * Renders nothing unless the file is source-dirty.
 */
const SourceEditsPendingBanner: React.FC<SourceEditsPendingBannerProps> = ({ filePath }) => {
  const openFiles = useFileStore((s) => s.openFiles);
  const adoptWorkingCode = useFileStore((s) => s.adoptWorkingCode);
  const setWorkingCode = useFileStore((s) => s.setWorkingCode);

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<ParseError[] | null>(null);

  const fileState = filePath ? openFiles.get(filePath) : undefined;
  if (!filePath || !fileState || !isSourceDirty(fileState)) {
    return null;
  }

  const handleApply = async () => {
    setBusy(true);
    setErrors(null);
    try {
      const result = await adoptWorkingCode(filePath);
      if (!result.ok) {
        setErrors(result.errors ?? []);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = () => {
    setErrors(null);
    setWorkingCode(filePath, undefined);
  };

  return (
    <Alert
      severity="info"
      square
      sx={{ borderRadius: 0 }}
      data-testid="source-edits-pending-banner"
      action={
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            size="small"
            color="inherit"
            onClick={handleDiscard}
            disabled={busy}
            data-testid="source-edits-discard"
          >
            Discard
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={() => void handleApply()}
            disabled={busy}
            data-testid="source-edits-apply"
          >
            Apply
          </Button>
        </Stack>
      }
    >
      Source edits pending — Apply (parse &amp; adopt) or Discard.
      {errors !== null && (
        <Box sx={{ mt: 1 }} data-testid="source-edits-errors">
          <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block' }}>
            {errors.length > 0
              ? 'The source could not be parsed:'
              : 'The source could not be parsed.'}
          </Typography>
          {errors.map((error, index) => (
            <Typography key={index} variant="caption" sx={{ display: 'block' }}>
              - {error.message}
            </Typography>
          ))}
        </Box>
      )}
    </Alert>
  );
};

export default SourceEditsPendingBanner;
