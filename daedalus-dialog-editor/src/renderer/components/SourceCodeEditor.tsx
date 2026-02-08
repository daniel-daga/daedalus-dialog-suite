import React, { useEffect, useState, useCallback, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { Box, CircularProgress, Typography, Paper, Fab, Tooltip } from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { useEditorStore } from '../store/editorStore';
import type { ParseError } from '../types/global';

interface SourceCodeEditorProps {
  filePath: string;
}

const SourceCodeEditor: React.FC<SourceCodeEditorProps> = ({ filePath }) => {
  const { openFiles, setWorkingCode, saveSource, codeSettings } = useEditorStore();
  const fileState = openFiles.get(filePath);

  const [isLoading, setIsLoading] = useState(false);
  const [editorValue, setEditorValue] = useState<string>('');
  const monacoRef = useRef<any>(null);

  // Determine initial content
  useEffect(() => {
    if (!fileState) return;

    // If we have working code (unsaved source edits), use it
    if (fileState.workingCode !== undefined) {
      setEditorValue(fileState.workingCode);
      return;
    }

    // If file has syntax errors, we MUST use originalCode (can't generate from invalid model)
    if (fileState.hasErrors) {
      setEditorValue(fileState.originalCode || '');
      return;
    }

    // If dirty (visual changes), generate code from model
    if (fileState.isDirty) {
      setIsLoading(true);
      window.editorAPI.generateCode(fileState.semanticModel, codeSettings)
        .then((code) => {
          setEditorValue(code);
          // We don't set workingCode here yet, only on edit
        })
        .catch((err) => {
          console.error('Failed to generate code:', err);
          setEditorValue('// Failed to generate code');
        })
        .finally(() => {
          setIsLoading(false);
        });
      return;
    }

    // Default: use original code (clean state)
    setEditorValue(fileState.originalCode || '');

  }, [filePath, fileState?.isDirty, fileState?.hasErrors, fileState?.originalCode, fileState?.workingCode, codeSettings]);

  // Handle editor mount
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    monacoRef.current = editor;

    // Add C-like syntax highlighting for Daedalus if not present
    // Note: This is a basic approximation using C++
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, 'cpp');
    }

    // Update markers if there are existing errors
    if (fileState?.errors && fileState.errors.length > 0) {
      updateMarkers(monaco, editor.getModel(), fileState.errors);
    }
  };

  // Update error markers
  const updateMarkers = (monaco: any, model: any, errors: ParseError[]) => {
    if (!monaco || !model) return;

    const markers = errors.map(err => ({
      severity: monaco.MarkerSeverity.Error,
      message: err.message,
      startLineNumber: err.position ? err.position.row : 1,
      startColumn: err.position ? err.position.column : 1,
      endLineNumber: err.position ? err.position.row : 1,
      endColumn: (err.position ? err.position.column : 1) + (err.text?.length || 1),
    }));

    monaco.editor.setModelMarkers(model, 'daedalus', markers);
  };

  // Handle content change
  const handleChange = useCallback((value: string | undefined) => {
    if (value === undefined) return;

    // Update local state
    setEditorValue(value);

    // Update store (debounced handled by store logic? No, we should debounce here or just set it)
    // Setting workingCode on every keystroke might be heavy if it triggers store listeners.
    // But for now, let's just set it.
    setWorkingCode(filePath, value);

    // Debounce validation/parsing could go here to update markers live
    // For now, we rely on save to fully validate/parse, or we can add a debounced checker.

  }, [filePath, setWorkingCode]);

  const handleSave = async () => {
    if (!editorValue) return;
    try {
      await saveSource(filePath, editorValue);
    } catch (error) {
      console.error('Save failed:', error);
    }
  };

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  if (!fileState) {
    return <Typography>No file open</Typography>;
  }

  return (
    <Box sx={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {isLoading && (
        <Box sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          bgcolor: 'rgba(255,255,255,0.7)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <CircularProgress />
        </Box>
      )}

      <Paper square sx={{ flexGrow: 1, borderTop: 1, borderColor: 'divider' }}>
        <Editor
          height="100%"
          defaultLanguage="cpp"
          value={editorValue}
          onChange={handleChange}
          onMount={handleEditorDidMount}
          theme="vs-light"
          options={{
            minimap: { enabled: true },
            fontSize: 14,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </Paper>

      {/* Floating Save Button */}
      <Tooltip title="Save Source (Ctrl+S)" placement="left">
        <Fab
          color="primary"
          aria-label="save"
          sx={{ position: 'absolute', bottom: 16, right: 16 }}
          onClick={handleSave}
        >
          <SaveIcon />
        </Fab>
      </Tooltip>

      {/* Error Display Overlay (if needed, but Monaco markers are better) */}
      {fileState.hasErrors && (
        <Box sx={{
          position: 'absolute',
          bottom: 80,
          right: 16,
          maxWidth: 400,
          maxHeight: 200,
          overflow: 'auto',
          bgcolor: 'error.main',
          color: 'error.contrastText',
          p: 1,
          borderRadius: 1,
          boxShadow: 3,
          opacity: 0.9
        }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
            {fileState.errors?.length || 0} Syntax Errors
          </Typography>
          <Typography variant="caption" display="block">
             Check editor markers for details.
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default SourceCodeEditor;
