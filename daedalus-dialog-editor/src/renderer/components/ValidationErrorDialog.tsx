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
  ListItemIcon,
  ListItemText,
  Alert,
  Box,
  Chip
} from '@mui/material';
import {
  Error as ErrorIcon,
  Warning as WarningIcon
} from '@mui/icons-material';
import type { ValidationResult, ValidationError, ValidationWarning } from '../types/global';

interface ValidationErrorDialogProps {
  open: boolean;
  validationResult: ValidationResult | null;
  /**
   * 'save-blocked' (default): errors stopped the save — offer Save Anyway.
   * 'saved-with-warnings': the save succeeded but produced warnings —
   * informational, Close only.
   */
  mode?: 'save-blocked' | 'saved-with-warnings';
  onClose: () => void;
  onSaveAnyway: () => void;
  onCancel: () => void;
}

const getErrorTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    syntax_error: 'Syntax Error',
    duplicate_dialog: 'Duplicate Dialog',
    missing_function: 'Missing Function',
    missing_required_property: 'Missing Property',
    circular_dependency: 'Circular Dependency',
    invalid_string_content: 'Invalid Text',
    duplicate_voice_id: 'Duplicate Voice ID',
    malformed_voice_id: 'Malformed Voice ID'
  };
  return labels[type] || type;
};

const getErrorTypeColor = (type: string): 'error' | 'warning' | 'info' => {
  const colors: Record<string, 'error' | 'warning' | 'info'> = {
    syntax_error: 'error',
    duplicate_dialog: 'error',
    missing_function: 'warning',
    missing_required_property: 'warning',
    circular_dependency: 'error',
    invalid_string_content: 'error',
    duplicate_voice_id: 'warning',
    malformed_voice_id: 'warning'
  };
  return colors[type] || 'error';
};

const ValidationErrorDialog: React.FC<ValidationErrorDialogProps> = ({
  open,
  validationResult,
  mode = 'save-blocked',
  onClose,
  onSaveAnyway,
  onCancel
}) => {
  if (!validationResult) return null;

  const { errors, warnings } = validationResult;
  const savedWithWarnings = mode === 'saved-with-warnings';
  const hasCriticalErrors = errors.some(e =>
    e.type === 'syntax_error' || e.type === 'circular_dependency'
  );
  // The E3 parse-loss entry means the model was opened with parse errors;
  // forcing the save drops the content the parser could not read.
  const hasParseLossWarning = errors.some(
    (e) => e.type === 'syntax_error' && /opened with \d+ parse error/i.test(e.message)
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {savedWithWarnings ? <WarningIcon color="warning" /> : <ErrorIcon color="error" />}
        {savedWithWarnings ? 'Saved with Warnings' : 'Validation Failed'}
      </DialogTitle>
      <DialogContent>
        {savedWithWarnings ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            The file was saved, but validation reported {warnings.length} warning{warnings.length !== 1 ? 's' : ''}.
          </Alert>
        ) : (
          <Alert severity="error" sx={{ mb: 2 }}>
            The generated code has {errors.length} error{errors.length !== 1 ? 's' : ''} that should be fixed before saving.
          </Alert>
        )}

        {errors.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
              Errors ({errors.length})
            </Typography>
            <List dense>
              {errors.map((error: ValidationError, index: number) => (
                <ListItem key={index} sx={{ py: 0.5 }}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <ErrorIcon color="error" fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={getErrorTypeLabel(error.type)}
                          size="small"
                          color={getErrorTypeColor(error.type)}
                          sx={{ fontSize: '0.7rem' }}
                        />
                        <Typography variant="body2">
                          {error.message}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      error.position
                        ? `Line ${error.position.row}, Column ${error.position.column}`
                        : error.dialogName
                          ? `Dialog: ${error.dialogName}`
                          : error.functionName
                            ? `Function: ${error.functionName}`
                            : undefined
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {warnings.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
              Warnings ({warnings.length})
            </Typography>
            <List dense>
              {warnings.map((warning: ValidationWarning, index: number) => (
                <ListItem key={index} sx={{ py: 0.5 }}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <WarningIcon color="warning" fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={warning.message}
                    secondary={
                      warning.dialogName
                        ? `Dialog: ${warning.dialogName}`
                        : warning.functionName
                          ? `Function: ${warning.functionName}`
                          : undefined
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {hasCriticalErrors && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            <strong>Warning:</strong> Saving with syntax errors may produce code that cannot be compiled.
            It is strongly recommended to fix these issues first.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {savedWithWarnings ? (
          <Button onClick={onClose} variant="contained">
            Close
          </Button>
        ) : (
          <>
            <Button onClick={onCancel} color="inherit">
              Cancel
            </Button>
            <Button
              onClick={onSaveAnyway}
              color="warning"
              variant="outlined"
            >
              {hasParseLossWarning ? 'Save anyway (drops unparsed content)' : 'Save Anyway'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ValidationErrorDialog;
