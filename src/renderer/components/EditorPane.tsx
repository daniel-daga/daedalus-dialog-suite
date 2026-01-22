import React, { forwardRef } from 'react';
import { Box, Typography, Alert, Fade } from '@mui/material';
import DialogDetailsEditor from './DialogDetailsEditor';
import DialogLoadingSkeleton from './DialogLoadingSkeleton';
import type { SemanticModel, Dialog, DialogFunction } from '../types/global';

interface EditorPaneProps {
  selectedDialog: string | null;
  dialogData: Dialog | null;
  currentFunctionName: string | null | undefined;
  currentFunctionData: DialogFunction | null;
  selectedFunctionName: string | null;
  filePath: string | null;
  semanticModel: SemanticModel;
  isProjectMode: boolean;
  isLoadingDialog: boolean;
  onNavigateToFunction: (functionName: string) => void;
}

/**
 * The right-most pane that displays the dialog editor or placeholder content
 */
const EditorPane = forwardRef<HTMLDivElement, EditorPaneProps>(({
  selectedDialog,
  dialogData,
  currentFunctionName,
  currentFunctionData,
  selectedFunctionName,
  filePath,
  semanticModel,
  isProjectMode,
  isLoadingDialog,
  onNavigateToFunction
}, ref) => {
  // No dialog selected - show placeholder
  if (!selectedDialog || !dialogData) {
    return (
      <Box
        ref={ref}
        sx={{
          flex: '1 1 auto',
          overflow: 'auto',
          p: 2,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%'
        }}
      >
        <Typography variant="body1" color="text.secondary">
          Select a dialog to edit
        </Typography>
      </Box>
    );
  }

  // No information function defined
  if (!currentFunctionName) {
    return (
      <Box
        ref={ref}
        sx={{
          flex: '1 1 auto',
          overflow: 'auto',
          p: 2,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%'
        }}
      >
        <Alert severity="warning">
          <Typography variant="body2">
            This dialog does not have an information function defined.
          </Typography>
        </Alert>
      </Box>
    );
  }

  // Function not found
  if (!currentFunctionData) {
    return (
      <Box
        ref={ref}
        sx={{
          flex: '1 1 auto',
          overflow: 'auto',
          p: 2,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%'
        }}
      >
        <Alert severity="error">
          <Typography variant="body2">
            Function "{currentFunctionName}" not found in the file.
          </Typography>
        </Alert>
      </Box>
    );
  }

  // Normal editing view
  return (
    <Box
      ref={ref}
      sx={{
        flex: '1 1 auto',
        overflow: 'auto',
        p: 2,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}
    >
      {/* Show loading skeleton during transition */}
      <Fade in={isLoadingDialog} unmountOnExit timeout={{ enter: 100, exit: 200 }}>
        <Box sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          p: 2,
          bgcolor: 'background.default',
          zIndex: 10,
          overflow: 'hidden'
        }}>
          <DialogLoadingSkeleton />
        </Box>
      </Fade>

      {/* Show actual content - hidden when loading */}
      <Box sx={{ width: '100%', opacity: isLoadingDialog ? 0 : 1, transition: 'opacity 0.2s' }}>
        <DialogDetailsEditor
          dialogName={selectedDialog}
          filePath={filePath}
          functionName={selectedFunctionName || undefined}
          onNavigateToFunction={onNavigateToFunction}
          semanticModel={semanticModel}
          isProjectMode={isProjectMode}
        />
      </Box>
    </Box>
  );
});

EditorPane.displayName = 'EditorPane';

export default EditorPane;
