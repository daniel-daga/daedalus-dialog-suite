import React from 'react';
import { Box, AppBar, Toolbar, Typography, Button, Container, Stack, Chip } from '@mui/material';
import { FolderOpen as FolderOpenIcon, Folder as FolderIcon } from '@mui/icons-material';
import { useEditorStore } from './store/editorStore';
import { useProjectStore } from './store/projectStore';
import ThreeColumnLayout from './components/ThreeColumnLayout';

const App: React.FC = () => {
  const { openFile, activeFile } = useEditorStore();
  const { openProject, projectPath, projectName } = useProjectStore();

  const handleOpenFile = async () => {
    const filePath = await window.editorAPI.openFileDialog();
    if (filePath) {
      await openFile(filePath);
    }
  };

  const handleOpenProject = async () => {
    const folderPath = await window.editorAPI.openProjectFolderDialog();
    if (folderPath) {
      await openProject(folderPath);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Dandelion
          </Typography>
          {projectName && (
            <Chip
              icon={<FolderIcon />}
              label={`Project: ${projectName}`}
              sx={{ mr: 2, bgcolor: 'rgba(255,255,255,0.1)', color: 'white' }}
            />
          )}
          <Button color="inherit" onClick={handleOpenProject} sx={{ mr: 1 }}>
            Open Project
          </Button>
          <Button color="inherit" onClick={handleOpenFile}>
            Open File
          </Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden' }}>
        {activeFile || projectPath ? (
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

                <Stack direction="row" spacing={2}>
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<FolderIcon />}
                    onClick={handleOpenProject}
                  >
                    Open Project
                  </Button>
                  <Button
                    variant="outlined"
                    size="large"
                    startIcon={<FolderOpenIcon />}
                    onClick={handleOpenFile}
                  >
                    Open Single File
                  </Button>
                </Stack>

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