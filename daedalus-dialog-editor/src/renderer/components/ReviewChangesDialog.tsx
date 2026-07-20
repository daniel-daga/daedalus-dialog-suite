import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useFileStore } from '../store/fileStore';
import CodeDiffView from './common/CodeDiffView';
import type { SemanticModel } from '../types/global';

interface ReviewChangesDialogProps {
  open: boolean;
  /** Path of the file being reviewed — its CURRENT on-disk content is the diff baseline. */
  filePath: string;
  /** Current semantic model — the source of the code that a save would write. */
  semanticModel: SemanticModel;
  /** Invokes the exact existing save path (handleSave). */
  onSave: () => Promise<void>;
  onClose: () => void;
}

/**
 * Review-before-save dialog (feature-suggestions item 6): shows a line diff of
 * the file's current on-disk content (read fresh on open, so earlier saves —
 * including auto-saves — are already reflected) against the code that would be
 * generated from the current semantic model, making round-trip fidelity
 * visible before the user commits to a save. Saving directly is unchanged.
 */
const ReviewChangesDialog: React.FC<ReviewChangesDialogProps> = ({
  open,
  filePath,
  semanticModel,
  onSave,
  onClose,
}) => {
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [diskCode, setDiskCode] = useState<string | null>(null);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [diskReadFailed, setDiskReadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setGeneratedCode(null);
      setDiskCode(null);
      setGenerationFailed(false);
      setDiskReadFailed(false);
      return;
    }

    let cancelled = false;
    setGeneratedCode(null);
    setDiskCode(null);
    setGenerationFailed(false);
    setDiskReadFailed(false);

    window.editorAPI.generateCode(semanticModel, useFileStore.getState().codeSettings)
      .then((code) => {
        if (!cancelled) {
          setGeneratedCode(code);
        }
      })
      .catch((error) => {
        console.error('Failed to generate code for review:', error);
        if (!cancelled) {
          setGenerationFailed(true);
        }
      });

    window.editorAPI.readFile(filePath)
      .then((code) => {
        if (!cancelled) {
          setDiskCode(code);
        }
      })
      .catch((error) => {
        console.error('Failed to read file from disk for review:', error);
        if (!cancelled) {
          setDiskReadFailed(true);
        }
      });

    return () => { cancelled = true; };
  }, [open, filePath, semanticModel]);

  const handleSaveClick = async () => {
    setIsSaving(true);
    try {
      await onSave();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" data-testid="review-changes-dialog">
      <DialogTitle>Review Changes</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          − file currently on disk · + code that will be written on save
        </Typography>
        {generationFailed ? (
          <Alert severity="error">Failed to generate code for review.</Alert>
        ) : diskReadFailed ? (
          <Alert severity="error" data-testid="review-changes-disk-error">
            Failed to read the file from disk for review. You can still save.
          </Alert>
        ) : generatedCode === null || diskCode === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }} data-testid="review-changes-loading">
            <CircularProgress size={28} />
          </Box>
        ) : (
          <CodeDiffView
            beforeCode={diskCode}
            afterCode={generatedCode}
            data-testid="review-changes-diff"
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSaving} data-testid="review-changes-close">
          Close
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSaveClick()}
          disabled={isSaving || generatedCode === null}
          data-testid="review-changes-save"
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReviewChangesDialog;
