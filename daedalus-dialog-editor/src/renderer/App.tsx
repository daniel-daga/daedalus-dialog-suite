import React, { useState, useEffect, useMemo } from 'react';
import { 
  Box, AppBar, Toolbar, Typography, Button, Container, Stack, Chip, Tooltip, IconButton,
  List, ListItem, ListItemButton, ListItemIcon, ListItemText, Paper, Divider, CircularProgress
} from '@mui/material';
import { 
  FolderOpen as FolderOpenIcon, 
  Folder as FolderIcon, 
  Save as SaveIcon, 
  ListAlt as ListAltIcon,
  History as HistoryIcon,
  Error as ErrorIcon
} from '@mui/icons-material';
import { useEditorStore } from './store/editorStore';
import { useProjectStore } from './store/projectStore';
import { useAutoSave } from './hooks/useAutoSave';
import MainLayout from './components/MainLayout';
import ErrorBoundary from './components/ErrorBoundary';
import { IngestedFilesDialog } from './components/IngestedFilesDialog';
import { RecentProject } from './types/global';

const App: React.FC = () => {
  const { openFile, activeFile, openFiles } = useEditorStore();
  const { openProject, projectPath, projectName, isIngesting, allDialogFiles, parsedFiles } = useProjectStore();
  const { isAutoSaving, lastAutoSaveTime } = useAutoSave();
  
  const activeFileState = activeFile ? openFiles.get(activeFile) : null;
  const autoSaveError = activeFileState?.autoSaveError;

  const [isIngestedFilesOpen, setIsIngestedFilesOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  const ingestionProgress = useMemo(() => {
    const total = allDialogFiles.length;
    if (total === 0) return 0;
    return (parsedFiles.size / total) * 100;
  }, [allDialogFiles.length, parsedFiles.size]);

  useEffect(() => {
    const fetchRecent = async () => {
      const recent = await window.editorAPI.getRecentProjects();
      setRecentProjects(recent);
    };
    fetchRecent();
  }, [projectPath]);

  const formatLastSaved = (date: Date | null): string => {
    if (!date) return '';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 60) return 'Just now';
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins === 1) return '1 min ago';
    if (diffMins < 60) return `${diffMins} mins ago`;
    return date.toLocaleTimeString();
  };

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
          {autoSaveError && (
            <Tooltip title={
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                  Validation errors prevented auto-save:
                </Typography>
                {autoSaveError.errors.map((err, i) => (
                  <Typography key={i} variant="caption" sx={{ display: 'block' }}>
                    • {err.message}
                  </Typography>
                ))}
              </Box>
            }>
              <Chip
                icon={<ErrorIcon sx={{ color: 'white !important' }} />}
                label="Auto-save Paused"
                size="small"
                color="error"
                sx={{ mr: 2, color: 'white' }}
              />
            </Tooltip>
          )}
          {isAutoSaving && (
            <Chip
              icon={<SaveIcon />}
              label="Saving..."
              size="small"
              sx={{ mr: 2, bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}
            />
          )}
          {!isAutoSaving && lastAutoSaveTime && (
            <Tooltip title={`Last auto-saved: ${lastAutoSaveTime.toLocaleTimeString()}`}>
              <Chip
                icon={<SaveIcon />}
                label={formatLastSaved(lastAutoSaveTime)}
                size="small"
                sx={{ mr: 2, bgcolor: 'rgba(255,255,255,0.1)', color: 'white' }}
              />
            </Tooltip>
          )}
          {projectName && (
            <Chip
              icon={<FolderIcon />}
              label={`Project: ${projectName}`}
              sx={{ mr: 2, bgcolor: 'rgba(255,255,255,0.1)', color: 'white' }}
            />
          )}
           <Tooltip title={isIngesting ? `Ingesting files: ${Math.round(ingestionProgress)}%` : "Ingested Files"}>
            <Box sx={{ position: 'relative', display: 'inline-flex', mr: 1, alignItems: 'center', justifyContent: 'center' }}>
              {isIngesting && (
                <>
                  <CircularProgress
                    variant="determinate"
                    value={100}
                    size={42}
                    thickness={4}
                    sx={{
                      color: 'rgba(255, 255, 255, 0.1)',
                      position: 'absolute',
                      zIndex: 0,
                    }}
                  />
                  <CircularProgress
                    variant="determinate"
                    value={ingestionProgress}
                    size={42}
                    thickness={4}
                    sx={{
                      color: 'white',
                      position: 'absolute',
                      zIndex: 0,
                      transition: 'stroke-dashoffset 0.3s ease-in-out',
                    }}
                  />
                </>
              )}
              <IconButton
                color="inherit"
                onClick={() => setIsIngestedFilesOpen(true)}
                sx={{ zIndex: 1 }}
              >
                <ListAltIcon />
              </IconButton>
            </Box>
          </Tooltip>
          <Button color="inherit" onClick={handleOpenProject} sx={{ mr: 1 }}>
            Open Project
          </Button>
          <Button color="inherit" onClick={handleOpenFile}>
            Open File
          </Button>
        </Toolbar>
      </AppBar>

      <IngestedFilesDialog 
        open={isIngestedFilesOpen} 
        onClose={() => setIsIngestedFilesOpen(false)} 
      />

      <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden' }}>
        <ErrorBoundary>
          {activeFile || projectPath ? (
            <MainLayout filePath={activeFile} />
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

                {recentProjects.length > 0 && (
                  <Paper sx={{ width: '100%', mt: 2 }}>
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center' }}>
                      <HistoryIcon sx={{ mr: 1, color: 'text.secondary' }} />
                      <Typography variant="subtitle1">Recent Projects</Typography>
                    </Box>
                    <Divider />
                    <List sx={{ pt: 0, pb: 0 }}>
                      {recentProjects.map((project) => (
                        <ListItem key={project.path} disablePadding>
                          <ListItemButton onClick={() => openProject(project.path)}>
                            <ListItemIcon>
                              <FolderIcon />
                            </ListItemIcon>
                            <ListItemText 
                              primary={project.name} 
                              secondary={project.path} 
                              primaryTypographyProps={{ variant: 'body2', fontWeight: 'medium' }}
                              secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                            />
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>
                  </Paper>
                )}

                <Typography variant="caption" color="text.secondary">
                  Have fun modding!
                </Typography>
              </Stack>
            </Container>
          </Box>
          )}
        </ErrorBoundary>
      </Box>
    </Box>
  );
};

export default App;