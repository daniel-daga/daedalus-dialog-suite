import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography
} from '@mui/material';
import { Close as CloseIcon, ContentCopy as CopyIcon } from '@mui/icons-material';
import Editor from '@monaco-editor/react';
import { useEditorStore } from '../store/editorStore';
import { SemanticModel } from '../types/global';

interface DialogSourceViewDialogProps {
  open: boolean;
  onClose: () => void;
  dialogName: string;
  semanticModel: SemanticModel;
}

const DialogSourceViewDialog: React.FC<DialogSourceViewDialogProps> = ({
  open,
  onClose,
  dialogName,
  semanticModel
}) => {
  const [code, setCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const { codeSettings } = useEditorStore();

  useEffect(() => {
    if (open && dialogName && semanticModel) {
      setIsLoading(true);
      window.editorAPI.generateDialogCode(semanticModel, dialogName, codeSettings)
        .then((generatedCode) => {
          setCode(generatedCode);
        })
        .catch((err) => {
          console.error('Failed to generate dialog code:', err);
          setCode(`// Error generating code for ${dialogName}
// ${err.message}`);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, dialogName, semanticModel, codeSettings]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: { height: '80vh' }
      }}
    >
      <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Source Code: {dialogName}</Typography>
        <Box>
          <Tooltip title="Copy to clipboard">
            <IconButton onClick={handleCopy}>
              <CopyIcon />
            </IconButton>
          </Tooltip>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <CircularProgress />
          </Box>
        ) : (
          <Editor
            height="100%"
            defaultLanguage="cpp"
            value={code}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: true },
              fontSize: 14,
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default DialogSourceViewDialog;
