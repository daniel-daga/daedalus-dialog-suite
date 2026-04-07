import React, { useState, useEffect, useMemo } from 'react';
import {
  Box, AppBar, Toolbar, Typography, Button, Container, Stack, Chip, Tooltip, IconButton,
  List, ListItem, ListItemButton, ListItemIcon, ListItemText, Paper, Divider, CircularProgress,
  Snackbar, Alert
} from '@mui/material';
import {
  FolderOpen as FolderOpenIcon,
  Folder as FolderIcon,
  Save as SaveIcon,
  ListAlt as ListAltIcon,
  History as HistoryIcon,
  Error as ErrorIcon,
  Refresh as RefreshIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  AutoAwesome as AutoAwesomeIcon,
  Undo as UndoIcon,
  Redo as RedoIcon
} from '@mui/icons-material';
import { useEditorStore } from './store/editorStore';
import { useHistoryStore } from './store/historyStore';
import { useProjectStore } from './store/projectStore';
import { useAutoSave } from './hooks/useAutoSave';
import { useFileWatcher } from './hooks/useFileWatcher';
import MainLayout from './components/MainLayout';
import ErrorBoundary from './components/ErrorBoundary';
import { IngestedFilesDialog } from './components/IngestedFilesDialog';
import ProjectOpeningOverlay from './components/ProjectOpeningOverlay';
import UpdateNotification from './components/UpdateNotification';
import { RecentProject } from './types/global';
import { ThemeMode } from './theme';
import { useThemeMode } from './themeContext';
import { initStoreSync } from './store/storeSync';

// Wire up the cross-store model sync once at module load.
// editorStore pushes semantic model changes to projectStore's parsed-files
// cache via a Zustand subscription rather than direct imports.
initStoreSync();

const themeOptions: Array<{ value: ThemeMode; label: string; icon: JSX.Element }> = [
  { value: 'dark', label: 'Dark', icon: <DarkModeIcon fontSize="small" /> },
  { value: 'light', label: 'Light', icon: <LightModeIcon fontSize="small" /> },
  { value: 'gothic', label: 'Gothic', icon: <AutoAwesomeIcon fontSize="small" /> },
];

const App: React.FC = () => {
  const { openFile, activeFile, openFiles, resetEditorSession } = useEditorStore();
  const { openProject, projectPath, projectName, isIngesting, allDialogFiles, parsedFiles, isIngestedFilesOpen, setIngestedFilesOpen } = useProjectStore();
  const editHistory = useHistoryStore(state => state.editHistory);
  const { undo, redo } = useHistoryStore.getState();
  const canUndo = activeFile ? (editHistory.get(activeFile)?.past.length ?? 0) > 0 : false;
  const canRedo = activeFile ? (editHistory.get(activeFile)?.future.length ?? 0) > 0 : false;
  const { isAutoSaving, lastAutoSaveTime } = useAutoSave();
  useFileWatcher();

  const activeFileState = activeFile ? openFiles.get(activeFile) : null;
  const autoSaveError = activeFileState?.autoSaveError;

  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [appError, setAppError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [isProjectOpening, setIsProjectOpening] = useState(false);
  const [triggerUpdateCheck, setTriggerUpdateCheck] = useState(false);
  const { mode, setMode } = useThemeMode();

  const ingestionProgress = useMemo(() => {
    const total = allDialogFiles.length;
    if (total === 0) return 0;
    return (parsedFiles.size / total) * 100;
  }, [allDialogFiles.length, parsedFiles.size]);

  const overlayTotalFiles = isIngesting ? allDialogFiles.length : 0;
  const overlayParsedFiles = isIngesting ? parsedFiles.size : 0;
  const showProjectOpeningOverlay = isProjectOpening || (!!projectPath && isIngesting);

  const hasUnsavedChanges = useMemo(
    () => Array.from(openFiles.values()).some((fileState) => fileState.isDirty),
    [openFiles]
  );

  useEffect(() => {
    const fetchRecent = async () => {
      const recent = await window.editorAPI.getRecentProjects();
      setRecentProjects(recent);
    };
    fetchRecent();
  }, [projectPath]);

  useEffect(() => {
    window.editorAPI.getAppVersion().then(setAppVersion);
  }, []);

  // Trigger update check ~5s after mount to avoid slowing perceived startup
  useEffect(() => {
    const timer = setTimeout(() => setTriggerUpdateCheck(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  const confirmDiscardChanges = (context: string): boolean => {
    if (!hasUnsavedChanges) {
      return true;
    }

    return window.confirm(`You have unsaved changes. Continue and ${context}?`);
  };

  const handleOpenFile = async () => {
    try {
      const filePath = await window.editorAPI.openFileDialog();
      if (filePath) {
        await openFile(filePath);
      }
    } catch (error) {
      setAppError(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const openProjectWithReset = async (nextProjectPath: string) => {
    const isReloadingCurrentProject = !!projectPath && projectPath === nextProjectPath;
    const context = isReloadingCurrentProject ? 'reload the project' : 'switch projects';

    if (!confirmDiscardChanges(context)) {
      return;
    }

    setIsProjectOpening(true);

    try {
      resetEditorSession();
      await openProject(nextProjectPath);
    } catch (error) {
      setAppError(`Failed to open project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProjectOpening(false);
    }
  };

  const handleOpenProject = async () => {
    try {
      const folderPath = await window.editorAPI.openProjectFolderDialog();
      if (folderPath) {
        await openProjectWithReset(folderPath);
      }
    } catch (error) {
      setAppError(`Failed to choose project folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleReload = async () => {
    if (projectPath) {
      await openProjectWithReset(projectPath);
      return;
    }

    if (!activeFile) {
      return;
    }

    if (!confirmDiscardChanges('reload the file')) {
      return;
    }

    try {
      await openFile(activeFile);
    } catch (error) {
      setAppError(`Failed to reload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Dandelion
          </Typography>
          {activeFile && (
            <>
              <Tooltip title="Undo (Ctrl+Z)">
                <span>
                  <IconButton
                    color="inherit"
                    aria-label="Undo"
                    disabled={!canUndo}
                    onClick={() => undo(activeFile)}
                  >
                    <UndoIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Redo (Ctrl+Y)">
                <span>
                  <IconButton
                    color="inherit"
                    aria-label="Redo"
                    disabled={!canRedo}
                    onClick={() => redo(activeFile)}
                    sx={{ mr: 1 }}
                  >
                    <RedoIcon />
                  </IconButton>
                </span>
              </Tooltip>
              {autoSaveError ? (
                <Tooltip title={
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                      Validation errors prevented auto-save:
                    </Typography>
                    {autoSaveError.errors.map((err, i) => (
                      <Typography key={i} variant="caption" sx={{ display: 'block' }}>
                        - {err.message}
                      </Typography>
                    ))}
                  </Box>
                }>
                  <ErrorIcon sx={{ color: 'error.light', mr: 1 }} />
                </Tooltip>
              ) : isAutoSaving ? (
                <Tooltip title="Saving...">
                  <SaveIcon sx={{ color: 'rgba(255,255,255,0.7)', mr: 1 }} />
                </Tooltip>
              ) : lastAutoSaveTime ? (
                <Tooltip title={`Last saved: ${lastAutoSaveTime.toLocaleTimeString()}`}>
                  <SaveIcon sx={{ color: 'rgba(255,255,255,0.4)', mr: 1 }} />
                </Tooltip>
              ) : null}
            </>
          )}
          {projectName && (
            <Chip
              icon={<FolderIcon />}
              label={`Project: ${projectName}`}
              sx={{ mr: 2, bgcolor: 'rgba(255,255,255,0.1)', color: 'white' }}
            />
          )}
           <Tooltip title={isIngesting ? `Ingesting files: ${Math.round(ingestionProgress)}%` : 'Ingested Files'}>
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
                onClick={() => setIngestedFilesOpen(true)}
                sx={{ zIndex: 1 }}
              >
                <ListAltIcon />
              </IconButton>
            </Box>
          </Tooltip>
          <Stack direction="row" spacing={0.5} sx={{ mr: 2 }}>
            {themeOptions.map((option) => (
              <Tooltip key={option.value} title={`${option.label} theme`}>
                <Chip
                  onClick={() => setMode(option.value)}
                  icon={option.icon}
                  label={option.label}
                  size="small"
                  variant={mode === option.value ? 'filled' : 'outlined'}
                  color={mode === option.value ? 'primary' : 'default'}
                  sx={{
                    cursor: 'pointer',
                    color: mode === option.value ? 'primary.contrastText' : 'white',
                    bgcolor: mode === option.value ? 'primary.main' : 'rgba(255,255,255,0.08)',
                    '& .MuiChip-icon': { color: 'inherit' },
                  }}
                />
              </Tooltip>
            ))}
          </Stack>
          <Button color="inherit" onClick={handleOpenProject} sx={{ mr: 1 }}>
            Open Project
          </Button>
          <Tooltip title="Reload">
            <span>
              <IconButton
                color="inherit"
                aria-label="Reload"
                onClick={() => void handleReload()}
                disabled={!projectPath && !activeFile}
              >
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <IngestedFilesDialog
        open={isIngestedFilesOpen}
        onClose={() => setIngestedFilesOpen(false)}
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
                          <ListItemButton onClick={() => void openProjectWithReset(project.path)}>
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

      {appVersion && (
        <Box
          component="footer"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            px: 1.5,
            py: 0.25,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <UpdateNotification triggerCheck={triggerUpdateCheck} />
          <Typography variant="caption" color="text.disabled">
            v{appVersion}
          </Typography>
        </Box>
      )}

      <ProjectOpeningOverlay
        open={showProjectOpeningOverlay}
        totalFiles={overlayTotalFiles}
        parsedFiles={overlayParsedFiles}
        projectName={projectName}
      />

      <Snackbar
        open={!!appError}
        autoHideDuration={5000}
        onClose={() => setAppError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setAppError(null)} severity="error" sx={{ width: '100%' }}>
          {appError}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default App;

