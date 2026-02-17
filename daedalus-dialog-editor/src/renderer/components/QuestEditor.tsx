import React, { useState, useMemo } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Paper, Alert, LinearProgress } from '@mui/material';
import { FormatListBulleted, AccountTree } from '@mui/icons-material';
import QuestList from './QuestList';
import QuestDetails from './QuestDetails';
import QuestFlow from './QuestFlow';
import { useProjectStore } from '../store/projectStore';
import { useEditorStore } from '../store/editorStore';
import type { SemanticModel } from '../types/global';

interface QuestEditorProps {
  semanticModel: SemanticModel;
  writableEnabled?: boolean;
}

const QuestEditor: React.FC<QuestEditorProps> = ({ semanticModel, writableEnabled = true }) => {
  const [viewMode, setViewMode] = useState<'details' | 'flow'>('details');

  const { getQuestUsage, isIngesting, parsedFiles, projectPath } = useProjectStore(state => ({
      getQuestUsage: state.getQuestUsage,
      isIngesting: state.isIngesting,
      parsedFiles: state.parsedFiles,
      projectPath: state.projectPath
  }));
  const { selectedQuest, setSelectedQuest } = useEditorStore((state) => ({
    selectedQuest: state.selectedQuest,
    setSelectedQuest: state.setSelectedQuest
  }));

  const isProjectMode = !!projectPath;

  // Use global project analysis when in project mode, otherwise fall back to provided model
  const activeModel = useMemo(() => {
      if (!selectedQuest) return semanticModel;

      if (isProjectMode) {
          return getQuestUsage(selectedQuest);
      }

      return semanticModel;
  }, [selectedQuest, isProjectMode, parsedFiles, getQuestUsage, semanticModel]);

  return (
    <Box sx={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
        <Box sx={{ width: 300, flexShrink: 0 }}>
            <QuestList
                semanticModel={semanticModel} // List always uses the base loaded model (definitions)
                selectedQuest={selectedQuest}
                onSelectQuest={setSelectedQuest}
            />
        </Box>
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Paper square elevation={0} sx={{ p: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1, mr: 2 }}>
                    {isIngesting && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Alert severity="info" sx={{ py: 0, '& .MuiAlert-message': { overflow: 'visible' } }}>
                                Scanning project files...
                            </Alert>
                            <Box sx={{ width: 100 }}>
                                <LinearProgress />
                            </Box>
                        </Box>
                    )}
                </Box>
                <ToggleButtonGroup
                    value={viewMode}
                    exclusive
                    onChange={(_, newMode) => newMode && setViewMode(newMode)}
                    size="small"
                >
                    <ToggleButton value="details" aria-label="Details View">
                        <FormatListBulleted fontSize="small" />
                    </ToggleButton>
                    <ToggleButton value="flow" aria-label="Flow View">
                        <AccountTree fontSize="small" />
                    </ToggleButton>
                </ToggleButtonGroup>
            </Paper>

            <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                {viewMode === 'details' ? (
                    <QuestDetails
                        semanticModel={activeModel}
                        questName={selectedQuest}
                    />
                ) : (
                    <QuestFlow
                        semanticModel={activeModel}
                        questName={selectedQuest}
                        writableEnabled={writableEnabled}
                    />
                )}
            </Box>
        </Box>
    </Box>
  );
};

export default QuestEditor;
