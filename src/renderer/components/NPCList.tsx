import React, { useMemo } from 'react';
import {
  Paper,
  Box,
  Typography,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  InputAdornment
} from '@mui/material';
import { FilterList as FilterListIcon } from '@mui/icons-material';
import { NPCListProps } from './dialogTypes';
import { useSearchStore } from '../store/searchStore';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

const Row = ({ index, style, data }: ListChildComponentProps) => {
  const { filteredNpcs, selectedNPC, onSelectNPC, npcMap } = data;
  const npc = filteredNpcs[index];

  return (
    <ListItem style={style} key={npc} disablePadding component="div" dense>
      <ListItemButton
        selected={selectedNPC === npc}
        onClick={() => onSelectNPC(npc)}
        style={{ height: '100%' }}
        dense
      >
        <ListItemText
          primary={npc}
          secondary={`${npcMap.get(npc)?.length || 0} dialog(s)`}
        />
      </ListItemButton>
    </ListItem>
  );
};

const NPCList: React.FC<NPCListProps> = ({ npcs, npcMap, selectedNPC, onSelectNPC }) => {
  const { npcFilter, setNpcFilter, filterNpcs } = useSearchStore();

  // Filter NPCs based on the current filter
  const filteredNpcs = useMemo(() => {
    return filterNpcs(npcs);
  }, [npcs, filterNpcs, npcFilter]);

  const itemData = useMemo(() => ({
    filteredNpcs,
    selectedNPC,
    onSelectNPC,
    npcMap
  }), [filteredNpcs, selectedNPC, onSelectNPC, npcMap]);

  return (
    <Paper sx={{ width: 250, height: '100%', overflow: 'hidden', borderRadius: 0, flexShrink: 0, display: 'flex', flexDirection: 'column' }} elevation={1}>
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
      <Box sx={{ flexGrow: 1, width: '100%', overflow: 'hidden', minHeight: 0 }}>
        {filteredNpcs.length > 0 ? (
          <AutoSizer>
            {({ height, width }) => (
              <FixedSizeList
                height={height}
                width={width}
                itemSize={60}
                itemCount={filteredNpcs.length}
                itemData={itemData}
              >
                {Row}
              </FixedSizeList>
            )}
          </AutoSizer>
        ) : (
          npcFilter && (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No NPCs match "{npcFilter}"
              </Typography>
            </Box>
          )
        )}
      </Box>
    </Paper>
  );
};

export default NPCList;
