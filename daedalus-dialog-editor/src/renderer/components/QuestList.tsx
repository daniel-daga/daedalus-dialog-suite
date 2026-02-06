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
import { Search as SearchIcon, Add as AddIcon, OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import type { SemanticModel } from '../types/global';
import CreateQuestDialog from './CreateQuestDialog';
import { useNavigation } from '../hooks/useNavigation';

interface QuestListProps {
  semanticModel: SemanticModel;
  selectedQuest: string | null;
  onSelectQuest: (questName: string) => void;
}

const QuestList: React.FC<QuestListProps> = ({ semanticModel, selectedQuest, onSelectQuest }) => {
  const { navigateToSymbol } = useNavigation();
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'used'>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Memoize the list of all TOPIC_ constants
  const quests = useMemo(() => {
    const constants = semanticModel.constants || {};
    return Object.values(constants).filter(c => c.name.startsWith('TOPIC_'));
  }, [semanticModel.constants]);

  // Memoize the set of used topics to enable "Used" filtering
  const usedTopics = useMemo(() => {
    if (viewMode !== 'used') return new Set<string>();

    const used = new Set<string>();

    // Check all functions for Log_* calls
    Object.values(semanticModel.functions || {}).forEach(func => {
      func.actions?.forEach(action => {
        if ('topic' in action && action.topic) {
           used.add(action.topic);
        }
      });
    });

    // Also check dialog information functions (if any actions are directly on dialogs, though actions are usually on functions)
    // The parser puts actions on DialogFunction, which are linked from Dialog.

    return used;
  }, [semanticModel.functions, viewMode]);

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
          <ListItem 
            key={quest.name} 
            disablePadding
            secondaryAction={
              <Tooltip title="Follow reference" arrow>
                <IconButton 
                  edge="end" 
                  size="small" 
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateToSymbol(quest.name);
                  }}
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            }
          >
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
