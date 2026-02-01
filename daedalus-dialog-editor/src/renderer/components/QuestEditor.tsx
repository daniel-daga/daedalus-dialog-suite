import React, { useState } from 'react';
import { Box } from '@mui/material';
import QuestList from './QuestList';
import QuestDetails from './QuestDetails';
import type { SemanticModel } from '../types/global';

interface QuestEditorProps {
  semanticModel: SemanticModel;
}

const QuestEditor: React.FC<QuestEditorProps> = ({ semanticModel }) => {
  const [selectedQuest, setSelectedQuest] = useState<string | null>(null);

  return (
    <Box sx={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
        <Box sx={{ width: 300, flexShrink: 0 }}>
            <QuestList
                semanticModel={semanticModel}
                selectedQuest={selectedQuest}
                onSelectQuest={setSelectedQuest}
            />
        </Box>
        <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
            <QuestDetails
                semanticModel={semanticModel}
                questName={selectedQuest}
            />
        </Box>
    </Box>
  );
};

export default QuestEditor;
