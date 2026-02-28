import React, { useState } from 'react';
import { Box, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography } from '@mui/material';
import QuestFlow from './components/QuestFlow';
import { nodeEditorMockModel, nodeEditorMockQuests } from './mocks/nodeEditorMockData';

const NodeEditorPlayground: React.FC = () => {
  const [selectedQuest, setSelectedQuest] = useState<string>(nodeEditorMockQuests[0]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      <Paper square elevation={1} sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6">Quest Node Editor Playground</Typography>
            <Typography variant="body2" color="text.secondary">
              Isolated browser playground with mock quest dialogs, conditions and transitions.
            </Typography>
          </Box>
          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel id="node-editor-quest-select-label">Quest</InputLabel>
            <Select
              labelId="node-editor-quest-select-label"
              value={selectedQuest}
              label="Quest"
              inputProps={{ 'data-testid': 'node-editor-quest-select' }}
              onChange={(event) => setSelectedQuest(event.target.value)}
            >
              {nodeEditorMockQuests.map((questName) => (
                <MenuItem key={questName} value={questName}>
                  {questName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        <QuestFlow semanticModel={nodeEditorMockModel} questName={selectedQuest} writableEnabled={false} />
      </Box>
    </Box>
  );
};

export default NodeEditorPlayground;
