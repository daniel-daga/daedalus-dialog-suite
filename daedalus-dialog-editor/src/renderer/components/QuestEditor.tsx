import React, { useMemo } from 'react';
import { Box, Paper, Alert, LinearProgress } from '@mui/material';
import { shallow } from 'zustand/shallow';
import QuestList from './QuestList';
import QuestDetails from './QuestDetails';
import { useProjectStore } from '../store/projectStore';
import { useUISelectionStore } from '../store/uiSelectionStore';
import type { SemanticModel } from '../types/global';

interface QuestEditorProps {
  semanticModel: SemanticModel;
}

const QuestEditor: React.FC<QuestEditorProps> = ({ semanticModel }) => {
  const { getQuestUsage, isIngesting, parseGeneration, projectPath } = useProjectStore((state) => ({
      getQuestUsage: state.getQuestUsage,
      isIngesting: state.isIngesting,
      parseGeneration: state.parseGeneration,
      projectPath: state.projectPath
  }), shallow);
  const { selectedQuest, setSelectedQuest } = useUISelectionStore((state) => ({
    selectedQuest: state.selectedQuest,
    setSelectedQuest: state.setSelectedQuest
  }), shallow);

  const isProjectMode = !!projectPath;

  // While a background ingestion is in flight, freeze the recompute token so the
  // per-file `parseGeneration` bumps do not re-run `getQuestUsage` (which scans
  // every parsed file). When ingestion ends the token flips to the live
  // generation, triggering exactly one recomputation against the full model set.
  const recomputeToken = isIngesting ? -1 : parseGeneration;

  // Use global project analysis when in project mode, otherwise fall back to provided model
  const activeModel = useMemo(() => {
      if (!selectedQuest) return semanticModel;

      if (isProjectMode) {
          return getQuestUsage(selectedQuest);
      }

      return semanticModel;
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuest, isProjectMode, recomputeToken, getQuestUsage, semanticModel]);

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
            {isIngesting && (
                <Paper square elevation={0} sx={{ p: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Alert severity="info" sx={{ py: 0, '& .MuiAlert-message': { overflow: 'visible' } }}>
                        Scanning project files...
                    </Alert>
                    <Box sx={{ width: 100 }}>
                        <LinearProgress />
                    </Box>
                </Paper>
            )}

            <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                <QuestDetails
                    semanticModel={activeModel}
                    questName={selectedQuest}
                />
            </Box>
        </Box>
    </Box>
  );
};

export default QuestEditor;
