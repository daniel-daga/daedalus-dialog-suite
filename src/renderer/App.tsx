import React from 'react';
import { Box, AppBar, Toolbar, Typography, Button, Container, Stack } from '@mui/material';
import { FolderOpen as FolderOpenIcon } from '@mui/icons-material';
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
          <Box sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default'
          }}>
            <Container maxWidth="sm">
              <Stack spacing={4} alignItems="center">
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h4" gutterBottom>
                    Welcome to Dandelion
                  </Typography>
                  <Typography variant="body1" color="text.secondary">
                    Gothic 2 Dialog Editor
                  </Typography>
                </Box>

                <Button
                  variant="contained"
                  size="large"
                  startIcon={<FolderOpenIcon />}
                  onClick={handleOpenFile}
                >
                  Open Dialog File
                </Button>

                <Typography variant="caption" color="text.secondary">
                  Have fun modding!
                </Typography>
              </Stack>
            </Container>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default App;