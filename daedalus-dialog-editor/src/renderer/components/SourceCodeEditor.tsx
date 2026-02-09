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
  const [editorValue, setEditorValue] = useState<string>(() => {
    if (!fileState) return '';
    return (fileState.workingCode ?? fileState.originalCode) || '';
  });
  const monacoRef = useRef<any>(null);
  const isInternalChange = useRef(false);

  // Determine initial content and handle external changes
  useEffect(() => {
    if (!fileState) return;

    // If change is coming from the store (not our own typing)
    if (!isInternalChange.current) {
        if (fileState.workingCode !== undefined && fileState.workingCode !== editorValue) {
            setEditorValue(fileState.workingCode);
            return;
        }

        if (!fileState.isDirty && fileState.originalCode !== editorValue) {
            setEditorValue(fileState.originalCode || '');
            return;
        }
    }

    // If dirty (visual changes), generate code from model
    if (fileState.isDirty && fileState.workingCode === undefined) {
      setIsLoading(true);
      window.editorAPI.generateCode(fileState.semanticModel, codeSettings)
        .then((code) => {
          if (!isInternalChange.current) {
            setEditorValue(code);
          }
        })
        .catch((err) => {
          console.error('Failed to generate code:', err);
          setEditorValue('// Failed to generate code');
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [filePath, fileState?.isDirty, fileState?.hasErrors, fileState?.originalCode, fileState?.workingCode, codeSettings]);

  // Update markers when errors change
  useEffect(() => {
    if (monacoRef.current && fileState?.errors) {
        const editor = monacoRef.current;
        const monaco = (window as any).monaco;
        if (monaco && editor.getModel()) {
            updateMarkers(monaco, editor.getModel(), fileState.errors);
        }
    }
  }, [fileState?.errors]);

  // Handle editor mount
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    monacoRef.current = editor;
    (window as any).monaco = monaco;

    // Add C-like syntax highlighting for Daedalus if not present
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, 'cpp');
    }

    // Update markers if there are existing errors
    if (fileState?.errors && fileState.errors.length > 0) {
      updateMarkers(monaco, model, fileState.errors);
    }
  };

  // Update error markers
  const updateMarkers = (monaco: any, model: any, errors: ParseError[]) => {
    if (!monaco || !model) return;

    const markers = errors.map(err => {
      const row = err.position ? err.position.row + 1 : 1;
      const col = err.position ? err.position.column + 1 : 1;
      return {
        severity: monaco.MarkerSeverity.Error,
        message: err.message,
        startLineNumber: row,
        startColumn: col,
        endLineNumber: row,
        endColumn: col + (err.text?.length || 1),
      };
    });

    monaco.editor.setModelMarkers(model, 'daedalus', markers);
  };

  // Debounced store update
  const debouncedSetWorkingCode = useRef<any>(null);
  
  // Handle content change
  const handleChange = useCallback((value: string | undefined) => {
    if (value === undefined) return;

    // Update local state
    setEditorValue(value);
    
    // Mark as internal change to prevent effect feedback loop
    isInternalChange.current = true;

    // Update store with debounce
    if (debouncedSetWorkingCode.current) {
        clearTimeout(debouncedSetWorkingCode.current);
    }
    
    debouncedSetWorkingCode.current = setTimeout(() => {
        setWorkingCode(filePath, value);
        isInternalChange.current = false;
    }, 500);

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
