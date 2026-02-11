import React, { useMemo } from 'react';
import {
  Paper,
  Box,
  Typography,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  InputAdornment,
  IconButton,
  Tooltip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  FilterList as FilterListIcon,
  Clear as ClearIcon,
  Add as AddIcon
} from '@mui/icons-material';
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

const NPCList: React.FC<NPCListProps> = ({ npcs, npcMap, selectedNPC, onSelectNPC, onAddNpc }) => {
  const { npcFilter, setNpcFilter, filterNpcs } = useSearchStore();
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [newNpcName, setNewNpcName] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

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

  const handleClear = () => {
    setNpcFilter('');
  };

  const handleCreate = async () => {
    const npcName = newNpcName.trim();
    if (!npcName || !onAddNpc) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      await onAddNpc(npcName);
      setNewNpcName('');
      setIsCreateOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create NPC.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Paper sx={{ width: 250, height: '100%', overflow: 'hidden', borderRadius: 0, flexShrink: 0, display: 'flex', flexDirection: 'column' }} elevation={1}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">NPCs</Typography>
          <Tooltip title="Add NPC">
            <span>
              <IconButton
                size="small"
                aria-label="Add NPC"
                onClick={() => {
                  setCreateError(null);
                  setIsCreateOpen(true);
                }}
                disabled={!onAddNpc}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
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
            ),
            endAdornment: npcFilter ? (
              <InputAdornment position="end">
                <Tooltip title="Clear filter">
                  <IconButton
                    size="small"
                    onClick={handleClear}
                    aria-label="Clear filter"
                    edge="end"
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ) : null
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

      <Dialog open={isCreateOpen} onClose={() => !isCreating && setIsCreateOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Create NPC</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            fullWidth
            label="NPC Name"
            placeholder="SLD_99999_NewNPC"
            value={newNpcName}
            onChange={(e) => setNewNpcName(e.target.value)}
            disabled={isCreating}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreate();
              }
            }}
          />
          {createError && (
            <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
              {createError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsCreateOpen(false)} disabled={isCreating}>Cancel</Button>
          <Button
            onClick={() => void handleCreate()}
            variant="contained"
            disabled={!newNpcName.trim() || isCreating}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default NPCList;
