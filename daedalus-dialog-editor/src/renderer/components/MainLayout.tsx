import React, { Suspense, lazy, useEffect } from 'react';
import { Box, CircularProgress, ToggleButton, ToggleButtonGroup, Paper, Tooltip, Typography } from '@mui/material';
import { Chat as ChatIcon, Book as BookIcon, DataObject as VariableIcon } from '@mui/icons-material';
import ThreeColumnLayout from './ThreeColumnLayout';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { isWritableQuestEditorEnabled } from '../config/features';
import type { SemanticModel } from '../types/global';

const QuestEditor = lazy(() => import('./QuestEditor'));
const VariableManager = lazy(() => import('./VariableManager'));

interface MainLayoutProps {
  filePath: string | null;
}

interface LoadingViewProps {
  label: string;
}

const LoadingView: React.FC<LoadingViewProps> = ({ label }) => (
  <Box
    sx={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 1,
      height: '100%'
    }}
  >
    <CircularProgress size={24} />
    <Typography variant="body2" color="text.secondary">{label}</Typography>
  </Box>
);

const MainLayout: React.FC<MainLayoutProps> = ({ filePath }) => {
  const { openFiles, activeView: view, setActiveView: setView } = useEditorStore();
  const { projectPath, mergedSemanticModel, loadQuestData } = useProjectStore();

  const fileState = filePath ? openFiles.get(filePath) : null;
  const isProjectMode = !!projectPath;
  const semanticModel = isProjectMode ? mergedSemanticModel : (fileState?.semanticModel || {});
  const writableQuestEditorEnabled = isWritableQuestEditorEnabled();

  useEffect(() => {
    if ((view === 'quest' || view === 'variable') && isProjectMode) {
      loadQuestData();
    }
  }, [view, isProjectMode, loadQuestData]);

  return (
    <Box sx={{ display: 'flex', height: '100%', width: '100%' }}>
      {/* Sidebar Navigation */}
      <Paper square elevation={2} sx={{ width: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 2, zIndex: 10, borderRight: 1, borderColor: 'divider' }}>
         <ToggleButtonGroup
            orientation="vertical"
            value={view}
            exclusive
            onChange={(_, newView) => newView && setView(newView)}
            sx={{ '& .MuiToggleButton-root': { mb: 1, border: 'none', borderRadius: 2 } }}
         >
            <Tooltip title="Dialog Editor" placement="right">
                <ToggleButton value="dialog" aria-label="Dialog Editor">
                    <ChatIcon />
                </ToggleButton>
            </Tooltip>
            <Tooltip title="Quest Editor" placement="right">
                <ToggleButton value="quest" aria-label="Quest Editor">
                    <BookIcon />
                </ToggleButton>
            </Tooltip>
            <Tooltip title="Variable Manager" placement="right">
                <ToggleButton value="variable" aria-label="Variable Manager">
                    <VariableIcon />
                </ToggleButton>
            </Tooltip>
            {/* <Tooltip title="Source Code" placement="right">
                <ToggleButton value="source" aria-label="Source Code">
                    <CodeIcon />
                </ToggleButton>
            </Tooltip> */}
         </ToggleButtonGroup>
      </Paper>

      {/* Main Content */}
      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
         {/* We use Box with display toggle to preserve state of ThreeColumnLayout when switching views */}
         <Box sx={{ display: view === 'dialog' ? 'block' : 'none', height: '100%' }}>
             <ThreeColumnLayout filePath={filePath} />
         </Box>

         {/* Source Code Editor (preserved in DOM for undo history) */}
         {/* <Box sx={{ display: view === 'source' ? 'block' : 'none', height: '100%' }}>
             {filePath && <SourceCodeEditor filePath={filePath} />}
         </Box> */}

         {view === 'quest' && (
             <Box sx={{ height: '100%' }}>
                 <Suspense fallback={<LoadingView label="Loading quest editor..." />}>
                   <QuestEditor
                     semanticModel={semanticModel as SemanticModel}
                     writableEnabled={writableQuestEditorEnabled}
                   />
                 </Suspense>
             </Box>
         )}

         {view === 'variable' && (
             <Box sx={{ height: '100%' }}>
                 <Suspense fallback={<LoadingView label="Loading variable manager..." />}>
                   <VariableManager />
                 </Suspense>
             </Box>
         )}
      </Box>
    </Box>
  );
};

export default MainLayout;
