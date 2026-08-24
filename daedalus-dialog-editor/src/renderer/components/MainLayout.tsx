import React, { Suspense, lazy, memo, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { Alert, Box, CircularProgress, ToggleButton, ToggleButtonGroup, Paper, Tooltip, Typography } from '@mui/material';
import { Chat as ChatIcon, Book as BookIcon, DataObject as VariableIcon, ReportProblem as ProblemsIcon } from '@mui/icons-material';
import ThreeColumnLayout from './ThreeColumnLayout';
import { useEditorStore } from '../store/editorStore';
import { useHistoryStore } from '../store/historyStore';
import { useUISelectionStore } from '../store/uiSelectionStore';
import { useProjectStore } from '../store/projectStore';
import { flushAllPendingEdits } from '../utils/pendingEditFlushRegistry';
import type { SemanticModel } from '../types/global';

const QuestEditor = lazy(() => import('./QuestEditor'));
const VariableManager = lazy(() => import('./VariableManager'));
const ProblemsPanel = lazy(() => import('./Problems/ProblemsPanel'));

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
  const fileState = useEditorStore((s) => (filePath ? s.openFiles.get(filePath) ?? null : null));
  const view = useUISelectionStore((s) => s.activeView);
  const setView = useUISelectionStore((s) => s.setActiveView);
  const projectPath = useProjectStore((s) => s.projectPath);
  // §3b: only the quest/variable panels consume the merged model. Gate the
  // subscription on the active view so a merge's fresh top-level identity does
  // not re-render the whole layout while the dialog view is active.
  const mergedSemanticModel = useProjectStore((s) => (view === 'dialog' ? null : s.mergedSemanticModel));
  const loadQuestData = useProjectStore((s) => s.loadQuestData);

  const isProjectMode = !!projectPath;
  const semanticModel = isProjectMode ? mergedSemanticModel : (fileState?.semanticModel || {});

  // E3: the active file was opened with parse errors — a partial model that
  // visual edits cannot fully see. Warn persistently in the dialog view.
  const activeFileHasParseErrors = !!fileState?.semanticModel?.hasErrors;
  const activeParseErrorCount =
    fileState?.semanticModel?.errors?.length ?? fileState?.errors?.length ?? 0;

  useEffect(() => {
    if ((view === 'quest' || view === 'variable') && isProjectMode) {
      loadQuestData();
    }
  }, [view, isProjectMode, loadQuestData]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isUndo = (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey;
      const isRedo = (e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey));

      if (!isUndo && !isRedo) return;

      // Let Monaco's built-in undo/redo handle events when the source editor is focused
      const activeElement = document.activeElement;
      if (activeElement?.closest('.monaco-editor')) return;

      const activeFilePath = useEditorStore.getState().activeFile;
      if (!activeFilePath) return;

      e.preventDefault();
      // Commit any in-flight debounced edit as a normal history step BEFORE the
      // undo/redo, so the first Ctrl+Z reverts the newest keystrokes and a late
      // timer cannot echo a phantom step onto the stack (finding U4).
      //
      // flushSync forces the flushed edit's render to commit before the undo
      // runs. Otherwise the flush (model -> edited) and the undo (edited ->
      // original) collapse into one React batch whose net store change is a
      // no-op reference, so the edited card never re-renders to drop its stale
      // local text — the field would keep showing the just-typed value.
      flushSync(() => {
        flushAllPendingEdits();
      });
      if (isUndo) useHistoryStore.getState().undo(activeFilePath);
      if (isRedo) useHistoryStore.getState().redo(activeFilePath);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
            <Tooltip title="Problems" placement="right">
                <ToggleButton value="problems" aria-label="Problems" data-testid="problems-toggle">
                    <ProblemsIcon />
                </ToggleButton>
            </Tooltip>
         </ToggleButtonGroup>
      </Paper>

      {/* Main Content */}
      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
         {/* We use Box with display toggle to preserve state of ThreeColumnLayout when switching views */}
         <Box sx={{ display: view === 'dialog' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
             {activeFileHasParseErrors && (
                 <Alert severity="warning" square sx={{ borderRadius: 0 }}>
                     Opened with {activeParseErrorCount} parse error{activeParseErrorCount === 1 ? '' : 's'} — visual edits cannot see all of this file. Saving from the visual editor will drop the content the parser could not read.
                 </Alert>
             )}
             <Box sx={{ flex: 1, minHeight: 0 }}>
                 <ThreeColumnLayout filePath={filePath} />
             </Box>
         </Box>

         {view === 'quest' && (
             <Box sx={{ height: '100%' }}>
                 <Suspense fallback={<LoadingView label="Loading quest editor..." />}>
                   <QuestEditor semanticModel={semanticModel as SemanticModel} />
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

         {view === 'problems' && (
             <Box sx={{ height: '100%' }}>
                 <Suspense fallback={<LoadingView label="Loading problems..." />}>
                   <ProblemsPanel />
                 </Suspense>
             </Box>
         )}
      </Box>
    </Box>
  );
};

// §3 P1: memo-wrapped so a parent re-render with the same `filePath` (a
// primitive prop) does not cascade into the layout; store-driven updates still
// arrive through the granular subscriptions above.
export default memo(MainLayout);
