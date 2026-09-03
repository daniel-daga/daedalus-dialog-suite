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
  Typography,
  useTheme,
  Snackbar,
  Alert
} from '@mui/material';
import { Close as CloseIcon, ContentCopy as CopyIcon } from '@mui/icons-material';
import Editor, { loader } from '@monaco-editor/react';

import { useEditorStore } from '../store/editorStore';
import { SemanticModel } from '../types/global';

// Load Monaco from the app's own origin instead of @monaco-editor/loader's
// default jsdelivr CDN. The `min/vs` tree is copied into the renderer output
// by the `monaco-local-assets` plugin in vite.config.ts, so this resolves to
// http://localhost:5173/monaco/vs in dev and file://.../dist/renderer/monaco/vs
// in the packaged app. Two reasons, both load-bearing:
//   1. The renderer's CSP is `default-src 'self'` (see security-model.md).
//      A remote script origin would have to be carved out of it.
//   2. Viewing source no longer needs the network, so it cannot stall (or fail)
//      offline.
// Resolved against document.baseURI rather than left relative: the AMD loader
// uses this as its module base URL, where a bare relative path is ambiguous.
loader.config({ paths: { vs: new URL('monaco/vs', document.baseURI).href } });

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
  const codeSettings = useEditorStore((s) => s.codeSettings);
  // Monaco ships two stock themes; follow the app palette's mode (F13).
  const monacoTheme = useTheme().palette.mode === 'dark' ? 'vs-dark' : 'light';

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

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
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
        {/* DialogTitle is already an h2; this is its text, not a second heading. */}
        <Typography variant="h6" component="span">Source Code: {dialogName}</Typography>
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
            theme={monacoTheme}
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
      <Snackbar open={copied} autoHideDuration={2000} onClose={() => setCopied(false)}>
        <Alert severity="success" onClose={() => setCopied(false)}>Copied to clipboard</Alert>
      </Snackbar>
    </Dialog>
  );
};

export default DialogSourceViewDialog;
