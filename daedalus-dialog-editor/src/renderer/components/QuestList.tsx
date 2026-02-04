import React, { useMemo, useState } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  TextField,
  InputAdornment,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
  Tooltip
} from '@mui/material';
import { Search as SearchIcon, Add as AddIcon } from '@mui/icons-material';
import type { SemanticModel } from '../types/global';
import CreateQuestDialog from './CreateQuestDialog';
import { useProjectStore } from '../store/projectStore';

interface QuestListProps {
  semanticModel: SemanticModel;
  selectedQuest: string | null;
  onSelectQuest: (questName: string) => void;
}

const QuestList: React.FC<QuestListProps> = ({ semanticModel, selectedQuest, onSelectQuest }) => {
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'used'>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Use symbols from store for the complete list of available quests
  // Fallback to semanticModel (passed prop) if store is empty (e.g. single file mode)
  const { symbols } = useProjectStore();

  // Memoize the list of all TOPIC_ constants
  const quests = useMemo(() => {
    // Priority: Store symbols (Global) > Semantic Model (Local/Merged)

    if (symbols && symbols.size > 0) {
        const questSymbols = Array.from(symbols.values())
            .filter(s => s.name.startsWith('TOPIC_'));
        return questSymbols;
    }

    const constants = semanticModel.constants || {};
    return Object.values(constants).filter(c => c.name.startsWith('TOPIC_'));
  }, [semanticModel.constants, symbols]);

  // Memoize the set of used topics to enable "Used" filtering
  const usedTopics = useMemo(() => {
    const used = new Set<string>();

    // Check all functions for Log_* calls
    // For this, we DO need the semantic model (actions), which might be partial.
    // However, for "Used" filter to be accurate across the project, we'd need full analysis.
    // Given the lazy loading architecture, "Used" might only show usage in *loaded* files.
    // To support "Used" fully, we might need to use `questReferences` from store.

    // Check local model first
    Object.values(semanticModel.functions || {}).forEach(func => {
      func.actions?.forEach(action => {
        if ('topic' in action && action.topic) {
           used.add(action.topic);
        }
      });
    });

    return used;
  }, [semanticModel.functions]);

  const filteredQuests = useMemo(() => {
    return quests.filter(q => {
      const matchesSearch = q.name.toLowerCase().includes(filter.toLowerCase()) ||
                            String(q.value).toLowerCase().includes(filter.toLowerCase());

      if (!matchesSearch) return false;

      if (viewMode === 'used') {
        return usedTopics.has(q.name);
      }

      return true;
    });
  }, [quests, filter, viewMode, usedTopics]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', borderRight: 1, borderColor: 'divider' }}>
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">Quests</Typography>
          <Tooltip title="Create New Quest">
            <IconButton onClick={() => setIsCreateDialogOpen(true)} size="small">
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Box>
        <TextField
          fullWidth
          size="small"
          placeholder="Search quests..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
          }}
          sx={{ mb: 2 }}
        />
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, mode) => mode && setViewMode(mode)}
          fullWidth
          size="small"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="used">Used</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Divider />
      <List sx={{ flexGrow: 1, overflow: 'auto' }}>
        {filteredQuests.map((quest) => (
          <ListItem key={quest.name} disablePadding>
            <ListItemButton
              selected={selectedQuest === quest.name}
              onClick={() => onSelectQuest(quest.name)}
            >
              <ListItemText
                primary={String(quest.value).replace(/^"|"$/g, '')} // Strip quotes for display
                secondary={quest.name}
              />
            </ListItemButton>
          </ListItem>
        ))}
        {filteredQuests.length === 0 && (
          <ListItem>
            <ListItemText secondary="No quests found" />
          </ListItem>
        )}
      </List>
      <CreateQuestDialog open={isCreateDialogOpen} onClose={() => setIsCreateDialogOpen(false)} />
    </Box>
  );
};

export default QuestList;
