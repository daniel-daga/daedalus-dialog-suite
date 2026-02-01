import React, { useState, useEffect } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Paper, Tooltip } from '@mui/material';
import { Chat as ChatIcon, Book as BookIcon } from '@mui/icons-material';
import ThreeColumnLayout from './ThreeColumnLayout';
import QuestEditor from './QuestEditor';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { SemanticModel } from '../types/global';

interface MainLayoutProps {
  filePath: string | null;
}

const MainLayout: React.FC<MainLayoutProps> = ({ filePath }) => {
  const [view, setView] = useState<'dialog' | 'quest'>('dialog');
  const { openFiles } = useEditorStore();
  const { projectPath, mergedSemanticModel, loadQuestData } = useProjectStore();

  const fileState = filePath ? openFiles.get(filePath) : null;
  const isProjectMode = !!projectPath;
  const semanticModel = isProjectMode ? mergedSemanticModel : (fileState?.semanticModel || {});

  useEffect(() => {
    if (view === 'quest' && isProjectMode) {
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
         </ToggleButtonGroup>
      </Paper>

      {/* Main Content */}
      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
         {/* We use Box with display toggle to preserve state of ThreeColumnLayout when switching views */}
         <Box sx={{ display: view === 'dialog' ? 'block' : 'none', height: '100%' }}>
             <ThreeColumnLayout filePath={filePath} />
         </Box>

         {view === 'quest' && (
             <Box sx={{ height: '100%' }}>
                 <QuestEditor semanticModel={semanticModel as SemanticModel} />
             </Box>
         )}
      </Box>
    </Box>
  );
};

export default MainLayout;
