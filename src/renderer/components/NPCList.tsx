import React from 'react';
import { Paper, Box, Typography, List, ListItem, ListItemButton, ListItemText } from '@mui/material';
import { NPCListProps } from './dialogTypes';

const NPCList: React.FC<NPCListProps> = ({ npcs, npcMap, selectedNPC, onSelectNPC }) => {
  return (
    <Paper sx={{ width: 250, overflow: 'auto', borderRadius: 0, flexShrink: 0 }} elevation={1}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6">NPCs</Typography>
        <Typography variant="caption" color="text.secondary">
          {npcs.length} total
        </Typography>
      </Box>
      <List dense>
        {npcs.map((npc) => (
          <ListItem key={npc} disablePadding>
            <ListItemButton
              selected={selectedNPC === npc}
              onClick={() => onSelectNPC(npc)}
            >
              <ListItemText
                primary={npc}
                secondary={`${npcMap.get(npc)?.length || 0} dialog(s)`}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Paper>
  );
};

export default NPCList;
