import React from 'react';
import { Box, AppBar, Toolbar, Typography, Button } from '@mui/material';
import { useEditorStore } from './store/editorStore';
import ThreeColumnLayout from './components/ThreeColumnLayout';

const App: React.FC = () => {
  const { openFile, activeFile } = useEditorStore();

  const handleOpenFile = async () => {
    const filePath = await window.editorAPI.openFileDialog();
    if (filePath) {
      await openFile(filePath);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Dandelion
          </Typography>
          <Button color="inherit" onClick={handleOpenFile}>
            Open File
          </Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden' }}>
        {activeFile ? (
          <ThreeColumnLayout filePath={activeFile} />
        ) : (
          <Box sx={{ flex: 1, p: 2, overflow: 'auto' }}>
            <Typography>No file open. Click "Open File" to get started.</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default App;