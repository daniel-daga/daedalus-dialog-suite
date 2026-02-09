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
import { Close as CloseIcon, ContentCopy as CopyIcon, OpenInNew as OpenInNewIcon } from '@mui/icons-material';
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

  const handleOpenInNewWindow = () => {
    // This is a placeholder for actual new window implementation if needed
    // For now, we'll just log it
    console.log('Open in new window requested for', dialogName);
    
    // In Electron, we can use window.open if it's enabled, 
    // but we'd need a route that handles displaying just the code.
    const win = window.open('', '_blank', 'width=800,height=600');
    if (win) {
      win.document.write(`
        <html>
          <head>
            <title>Source Code: ${dialogName}</title>
            <style>
              body { margin: 0; padding: 20px; background: #1e1e1e; color: #d4d4d4; font-family: 'Consolas', 'Monaco', 'Courier New', monospace; white-space: pre; }
            </style>
          </head>
          <body>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body>
        </html>
      `);
    }
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
          <Tooltip title="Open in new window">
            <IconButton onClick={handleOpenInNewWindow}>
              <OpenInNewIcon />
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
