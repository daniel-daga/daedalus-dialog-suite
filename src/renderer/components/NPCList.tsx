import React, { useMemo } from 'react';
import {
  Paper,
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  InputAdornment
} from '@mui/material';
import { FilterList as FilterListIcon } from '@mui/icons-material';
import { NPCListProps } from './dialogTypes';
import { useSearchStore } from '../store/searchStore';

const NPCList: React.FC<NPCListProps> = ({ npcs, npcMap, selectedNPC, onSelectNPC }) => {
  const { npcFilter, setNpcFilter, filterNpcs } = useSearchStore();

  // Filter NPCs based on the current filter
  const filteredNpcs = useMemo(() => {
    return filterNpcs(npcs);
  }, [npcs, filterNpcs, npcFilter]);

  return (
    <Paper sx={{ width: 250, overflow: 'hidden', borderRadius: 0, flexShrink: 0, display: 'flex', flexDirection: 'column' }} elevation={1}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Typography variant="h6">NPCs</Typography>
        <Typography variant="caption" color="text.secondary">
          {filteredNpcs.length} of {npcs.length} shown
        </Typography>
      </Box>
      <Box sx={{ px: 1, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Filter NPCs..."
          value={npcFilter}
          onChange={(e) => setNpcFilter(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <FilterListIcon fontSize="small" color="action" />
              </InputAdornment>
            )
          }}
        />
      </Box>
      <List dense sx={{ overflow: 'auto', flexGrow: 1 }}>
        {filteredNpcs.map((npc) => (
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
        {filteredNpcs.length === 0 && npcFilter && (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No NPCs match "{npcFilter}"
            </Typography>
          </Box>
        )}
      </List>
    </Paper>
  );
};

export default NPCList;
