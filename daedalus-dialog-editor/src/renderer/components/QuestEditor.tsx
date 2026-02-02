import React, { useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Paper } from '@mui/material';
import { FormatListBulleted, AccountTree } from '@mui/icons-material';
import QuestList from './QuestList';
import QuestDetails from './QuestDetails';
import QuestFlow from './QuestFlow';
import type { SemanticModel } from '../types/global';

interface QuestEditorProps {
  semanticModel: SemanticModel;
}

const QuestEditor: React.FC<QuestEditorProps> = ({ semanticModel }) => {
  const [selectedQuest, setSelectedQuest] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'details' | 'flow'>('details');

  return (
    <Box sx={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
        <Box sx={{ width: 300, flexShrink: 0 }}>
            <QuestList
                semanticModel={semanticModel}
                selectedQuest={selectedQuest}
                onSelectQuest={setSelectedQuest}
            />
        </Box>
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Paper square elevation={0} sx={{ p: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
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
                        semanticModel={semanticModel}
                        questName={selectedQuest}
                    />
                ) : (
                    <QuestFlow
                        semanticModel={semanticModel}
                        questName={selectedQuest}
                    />
                )}
            </Box>
        </Box>
    </Box>
  );
};

export default QuestEditor;
