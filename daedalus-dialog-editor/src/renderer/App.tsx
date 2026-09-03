import React, { useState, useEffect, useMemo } from 'react';
import {
  Box, AppBar, Toolbar, Typography, Button, Container, Stack, Chip, Tooltip, IconButton,
  List, ListItem, ListItemButton, ListItemIcon, ListItemText, Paper, Divider, CircularProgress,
  Snackbar, Alert, Badge
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
  Redo as RedoIcon,
  Description as DescriptionIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import { useEditorStore } from './store/editorStore';
import { useHistoryStore } from './store/historyStore';
import { useProjectStore } from './store/projectStore';
import { useUISelectionStore } from './store/uiSelectionStore';
import { useAutoSave } from './hooks/useAutoSave';
import { useManualSave } from './hooks/useManualSave';
import { useFileWatcher } from './hooks/useFileWatcher';
import MainLayout from './components/MainLayout';
import ExternalChangeConflictDialog from './components/ExternalChangeConflictDialog';
import ErrorBoundary from './components/ErrorBoundary';
import { IngestedFilesDialog } from './components/IngestedFilesDialog';
import ProjectOpeningOverlay from './components/ProjectOpeningOverlay';
import UpdateNotification from './components/UpdateNotification';
import { RecentProject } from './types/global';
import { ThemeMode } from './theme';
import { useThemeMode } from './themeContext';
import { initStoreSync } from './store/storeSync';
import { shallow } from 'zustand/shallow';
import { describeSaveError } from './utils/saveError';
import { hasUnsavedChanges as fileHasUnsavedChanges } from './store/fileStore';
import { flushAllPendingEdits } from './utils/pendingEditFlushRegistry';
import { useWindowCloseGuard } from './hooks/useWindowCloseGuard';
import AssetSourcesDialog from './components/AssetSourcesDialog';
import DeleteConfirmDialog from './components/common/DeleteConfirmDialog';
import { useWorldStore } from './store/worldStore';

// Wire up the cross-store model sync once at module load.
// editorStore pushes semantic model changes to projectStore's parsed-files
// cache via a Zustand subscription rather than direct imports.
initStoreSync();

const themeOptions: Array<{ value: ThemeMode; label: string; icon: JSX.Element }> = [
  { value: 'dark', label: 'Dark', icon: <DarkModeIcon fontSize="small" /> },
  { value: 'light', label: 'Light', icon: <LightModeIcon fontSize="small" /> },
  { value: 'gothic', label: 'Gothic', icon: <AutoAwesomeIcon fontSize="small" /> },
];

const AppContent: React.FC = () => {
  const { openFile, activeFile, resetEditorSession } = useEditorStore((state) => ({
    openFile: state.openFile,
    activeFile: state.activeFile,
    resetEditorSession: state.resetEditorSession,
  }), shallow);
  const { openProject, closeProject, projectPath, projectName, projectFilePath, projectConfig, projectWarnings, isIngesting, allDialogFiles, parsedFilesCount, metadataFailures, isIngestedFilesOpen, setIngestedFilesOpen, saveAssetSources } = useProjectStore((state) => ({
    openProject: state.openProject,
    closeProject: state.closeProject,
    projectPath: state.projectPath,
    projectName: state.projectName,
    projectFilePath: state.projectFilePath,
    projectConfig: state.projectConfig,
    projectWarnings: state.projectWarnings,
    isIngesting: state.isIngesting,
    allDialogFiles: state.allDialogFiles,
    parsedFilesCount: state.parsedFiles.size,
    metadataFailures: state.metadataFailures,
    isIngestedFilesOpen: state.isIngestedFilesOpen,
    setIngestedFilesOpen: state.setIngestedFilesOpen,
    saveAssetSources: state.saveAssetSources,
  }), shallow);
  const worldLoaded = useWorldStore((state) => state.summary !== null);
  const visibleProjectWarnings = projectWarnings ?? [];
  const { undo, redo } = useHistoryStore.getState();
  const canUndo = useHistoryStore((state) => (activeFile ? (state.editHistory.get(activeFile)?.past.length ?? 0) > 0 : false));
  const canRedo = useHistoryStore((state) => (activeFile ? (state.editHistory.get(activeFile)?.future.length ?? 0) > 0 : false));
  // These buttons drive the *dialog* history unconditionally (they call
  // `undo(activeFile)`/`redo(activeFile)` directly, not through the
  // view-guarded keyboard handler in MainLayout). The World surface has its
  // own history in the main process, so while it is on screen these would
  // silently undo a dialog edit in a file the user cannot see — the
  // button-shaped hole beside the already-guarded Ctrl+Z.
  const worldViewActive = useUISelectionStore((state) => state.activeView === 'world');
  const { isAutoSaving, lastAutoSaveTime } = useAutoSave();
  useFileWatcher();
  const closeGuardDialog = useWindowCloseGuard();

  const setActiveFile = useEditorStore((state) => state.setActiveFile);

  // §3 P1: never subscribe to the whole `openFiles` Map — every edit flush
  // gives it a fresh identity in the immer store, which would re-render App
  // (and the whole tree under it) on every keystroke flush. Subscribe only to
  // the active file's entry; anything not needed reactively goes through
  // `useEditorStore.getState()` (see confirmDiscardChanges).
  const activeFileState = useEditorStore((state) =>
    state.activeFile ? state.openFiles.get(state.activeFile) ?? null : null
  );
  const autoSaveError = activeFileState?.autoSaveError;
  const saveError = activeFileState?.saveError;
  const activeDirty = !!activeFileState?.isDirty;

  // Files in external conflict that are not the active file: the active file's
  // conflict opens the modal dialog; background conflicts surface as an app-bar
  // chip so they are not lost (E4). Derived as an array of paths compared with
  // `shallow`, so its identity is stable while the conflict set is unchanged.
  const backgroundConflictPaths = useEditorStore(
    (state) =>
      Array.from(state.openFiles.values())
        .filter((fileState) => fileState.externalConflict && fileState.filePath !== state.activeFile)
        .map((fileState) => fileState.filePath),
    shallow
  );

  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [appError, setAppError] = useState<string | null>(null);
  const { saveActiveFile, isManualSaving } = useManualSave(setAppError);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [isProjectOpening, setIsProjectOpening] = useState(false);
  const [triggerUpdateCheck, setTriggerUpdateCheck] = useState(false);
  const [assetSourcesOpen, setAssetSourcesOpen] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState<{ context: string; proceed: () => void } | null>(null);
  const [dismissedProjectWarnings, setDismissedProjectWarnings] = useState<Set<string>>(() => new Set());
  const { mode, setMode } = useThemeMode();
  const appWarnings = visibleProjectWarnings.filter((warning) => !dismissedProjectWarnings.has(warning.resolvedPath));

  const ingestionProgress = useMemo(() => {
    const total = allDialogFiles.length;
    if (total === 0) return 0;
    return (parsedFilesCount / total) * 100;
  }, [allDialogFiles.length, parsedFilesCount]);

  const overlayTotalFiles = isIngesting ? allDialogFiles.length : 0;
  const overlayParsedFiles = isIngesting ? parsedFilesCount : 0;
  const showProjectOpeningOverlay = isProjectOpening || (!!projectPath && isIngesting);

  useEffect(() => {
    setDismissedProjectWarnings(new Set());
    setAssetSourcesOpen(false);
  }, [projectPath]);


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

  // Runs `proceed` at once when nothing is unsaved; otherwise parks it behind
  // the in-app guard below, which runs it on "Discard and continue".
  const withDiscardConfirmed = (context: string, proceed: () => void): void => {
    // Drain any debounced condition/action edit (N4) so a pending keystroke
    // counts toward dirtiness, then evaluate against the live store — the flush
    // mutates the store synchronously, after this render's memo was computed.
    flushAllPendingEdits();

    const hasUnsavedChanges = Array.from(useEditorStore.getState().openFiles.values())
      .some((fileState) => fileHasUnsavedChanges(fileState));
    if (!hasUnsavedChanges) {
      proceed();
      return;
    }

    setDiscardPrompt({ context, proceed });
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

  const openProjectWithReset = (nextProjectPath: string) => {
    const isReloadingCurrentProject = !!projectPath && projectPath === nextProjectPath;
    const context = isReloadingCurrentProject ? 'reload the project' : 'switch projects';

    withDiscardConfirmed(context, async () => {
      setIsProjectOpening(true);

      try {
        resetEditorSession();
        await openProject(nextProjectPath);
      } catch (error) {
        setAppError(`Failed to open project: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setIsProjectOpening(false);
      }
    });
  };

  const handleOpenProject = async () => {
    try {
      const folderPath = await window.editorAPI.openProjectFolderDialog();
      if (folderPath) {
        openProjectWithReset(folderPath);
      }
    } catch (error) {
      setAppError(`Failed to choose project folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCloseProject = () => {
    withDiscardConfirmed('close the project', () => {
      resetEditorSession();
      closeProject();
    });
  };

  const handleReload = () => {
    if (projectPath) {
      openProjectWithReset(projectPath);
      return;
    }

    if (!activeFile) {
      return;
    }

    withDiscardConfirmed('reload the file', async () => {
      try {
        await openFile(activeFile);
      } catch (error) {
        setAppError(`Failed to reload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });
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
                    disabled={!canUndo || worldViewActive}
                    onClick={() => undo(activeFile)}
                    data-testid="appbar-undo-button"
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
                    disabled={!canRedo || worldViewActive}
                    onClick={() => redo(activeFile)}
                    sx={{ mr: 1 }}
                    data-testid="appbar-redo-button"
                  >
                    <RedoIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={
                saveError ? (
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    {describeSaveError(saveError)}
                  </Typography>
                ) : autoSaveError ? (
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
                ) : (isAutoSaving || isManualSaving) ? (
                  'Saving...'
                ) : activeDirty ? (
                  'Unsaved changes — Ctrl+S to save'
                ) : lastAutoSaveTime ? (
                  `Last saved: ${lastAutoSaveTime.toLocaleTimeString()}`
                ) : (
                  'All changes saved'
                )
              }>
                <span>
                  <IconButton
                    color="inherit"
                    aria-label="Save"
                    data-testid="appbar-save-button"
                    disabled={!activeDirty}
                    onClick={() => void saveActiveFile()}
                    sx={{ mr: 1 }}
                  >
                    {(saveError || autoSaveError) ? (
                      <ErrorIcon sx={{ color: 'error.light' }} />
                    ) : (
                      <SaveIcon sx={{
                        color: (isAutoSaving || isManualSaving)
                          ? 'rgba(255,255,255,0.7)'
                          : activeDirty
                            ? 'warning.light'
                            : 'rgba(255,255,255,0.4)'
                      }} />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
          {backgroundConflictPaths.length > 0 && (
            <Tooltip
              title={
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                    Files changed on disk with unsaved changes:
                  </Typography>
                  {backgroundConflictPaths.map((conflictPath) => (
                    <Typography key={conflictPath} variant="caption" sx={{ display: 'block' }}>
                      - {conflictPath}
                    </Typography>
                  ))}
                </Box>
              }
            >
              <Chip
                icon={<ErrorIcon />}
                color="error"
                label={`Conflicts: ${backgroundConflictPaths.length}`}
                onClick={() => setActiveFile(backgroundConflictPaths[0])}
                sx={{ mr: 2, cursor: 'pointer' }}
                data-testid="background-conflict-chip"
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
          {projectPath && projectConfig && (
            <Button color="inherit" onClick={() => setAssetSourcesOpen(true)} sx={{ mr: 1 }}>
              Asset sources...
            </Button>
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
                <Badge badgeContent={metadataFailures.length} color="warning">
                  <ListAltIcon />
                </Badge>
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
                onClick={handleReload}
                disabled={!projectPath && !activeFile}
              >
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
          {projectPath && (
            <Tooltip title="Close Project">
              <IconButton
                color="inherit"
                aria-label="Close Project"
                data-testid="close-project-button"
                onClick={handleCloseProject}
              >
                <CloseIcon />
              </IconButton>
            </Tooltip>
          )}
        </Toolbar>
      </AppBar>

      <IngestedFilesDialog
        open={isIngestedFilesOpen}
        onClose={() => setIngestedFilesOpen(false)}
      />

      {projectConfig && projectFilePath && (
        <AssetSourcesDialog
          open={assetSourcesOpen}
          assetSources={projectConfig.assetSources}
          gmbtProjectDir={projectConfig.gmbtProjectDir ?? null}
          projectRoot={projectPath}
          warnings={visibleProjectWarnings}
          worldLoaded={worldLoaded}
          onClose={() => setAssetSourcesOpen(false)}
          onSave={saveAssetSources}
        />
      )}

      {appWarnings.map((warning) => (
        <Snackbar key={warning.resolvedPath} open anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
          <Alert severity="warning" onClose={() => setDismissedProjectWarnings((current) => new Set(current).add(warning.resolvedPath))}>
            {warning.message}
          </Alert>
        </Snackbar>
      ))}

      <ExternalChangeConflictDialog />
      {closeGuardDialog}
      <DeleteConfirmDialog
        open={discardPrompt !== null}
        title="Unsaved changes"
        message={`You have unsaved changes. Continue and ${discardPrompt?.context ?? ''}?`}
        confirmLabel="Discard and continue"
        onConfirm={() => {
          const prompt = discardPrompt;
          setDiscardPrompt(null);
          prompt?.proceed();
        }}
        onCancel={() => setDiscardPrompt(null)}
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
                          <ListItemButton onClick={() => openProjectWithReset(project.path)}>
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
          <Tooltip title="Show log file">
            <IconButton
              size="small"
              aria-label="Show log file"
              onClick={() => void window.editorAPI.showLogFile()}
              sx={{ mr: 0.5, color: 'text.disabled' }}
            >
              <DescriptionIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
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

/**
 * The chrome — AppBar, close guard, conflict and update dialogs — lives outside
 * the boundary that wraps MainLayout, so a crash there used to take the whole
 * window down with it (production review §2). This outer boundary catches those;
 * the inner one still keeps the chrome alive when only MainLayout fails.
 */
const App: React.FC = () => (
  <ErrorBoundary>
    <AppContent />
  </ErrorBoundary>
);

export default App;

