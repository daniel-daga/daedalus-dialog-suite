import React, { useMemo, useState, memo, useEffect, useRef } from 'react';
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
  Tooltip,
  ListItemIcon,
  Select,
  MenuItem,
  FormControl,
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  OpenInNew as OpenInNewIcon,
  Check as CheckIcon,
  Build as BuildIcon,
  Report as ReportIcon,
  HourglassEmpty as HourglassEmptyIcon,
  FilterList as FilterListIcon
} from '@mui/icons-material';
import { FixedSizeList, ListChildComponentProps, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { SemanticModel } from '../types/global';
import CreateQuestDialog from './CreateQuestDialog';
import { useNavigation } from '../hooks/useNavigation';
import { analyzeQuest, getUsedQuestTopics } from './QuestEditor/questAnalysis';

interface QuestListProps {
  semanticModel: SemanticModel;
  selectedQuest: string | null;
  onSelectQuest: (questName: string) => void;
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'implemented': return <CheckIcon color="success" fontSize="small" />;
    case 'wip': return <BuildIcon color="info" fontSize="small" />;
    case 'broken': return <ReportIcon color="error" fontSize="small" />;
    case 'not_started': return <HourglassEmptyIcon color="disabled" fontSize="small" />;
    default: return <HourglassEmptyIcon color="disabled" fontSize="small" />;
  }
};

const getStatusTooltip = (status: string) => {
    switch (status) {
      case 'implemented': return 'Implemented (Start & End)';
      case 'wip': return 'In Progress (Start but no End)';
      case 'broken': return 'Broken (Missing Variable)';
      case 'not_started': return 'Not Started (No actions)';
      default: return '';
    }
};

const Row = memo(({ index, style, data }: ListChildComponentProps) => {
  const { filteredQuests, selectedQuest, onSelectQuest, questAnalysisMap, navigateToSymbol } = data;
  const quest = filteredQuests[index];
  const analysis = questAnalysisMap.get(quest.name);
  const status = analysis?.status || 'not_started';

  return (
    <div style={style}>
      <ListItem
        disablePadding
        component="div"
        role="listitem"
        secondaryAction={
          <Tooltip title="Follow reference" arrow>
            <IconButton
              edge="end"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                navigateToSymbol(quest.name, { preferSource: true });
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
          sx={{ pr: 6 }}
        >
          <ListItemIcon sx={{ minWidth: 30 }}>
              <Tooltip title={getStatusTooltip(status)}>
                  {getStatusIcon(status)}
              </Tooltip>
          </ListItemIcon>
          <ListItemText
            primary={String(quest.value).replace(/^"|"$/g, '')} // Strip quotes for display
            secondary={quest.name}
            primaryTypographyProps={{ noWrap: true }}
            secondaryTypographyProps={{ noWrap: true, fontSize: '0.75rem' }}
          />
        </ListItemButton>
      </ListItem>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom equality check to prevent unnecessary re-renders
  if (prevProps.style !== nextProps.style) return false;
  if (prevProps.index !== nextProps.index) return false;

  const prevData = prevProps.data;
  const nextData = nextProps.data;

  if (prevData.filteredQuests !== nextData.filteredQuests) return false; // Filter changed
  if (prevData.questAnalysisMap !== nextData.questAnalysisMap) return false; // Analysis changed

  // Check selection
  const questName = nextData.filteredQuests[nextProps.index].name;
  const isSelectedPrev = prevData.selectedQuest === questName;
  const isSelectedNext = nextData.selectedQuest === questName;

  return isSelectedPrev === isSelectedNext;
});

const QuestList: React.FC<QuestListProps> = ({ semanticModel, selectedQuest, onSelectQuest }) => {
  const { navigateToSymbol } = useNavigation();
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'used'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'broken' | 'wip' | 'implemented' | 'not_started'>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const listRef = useRef<FixedSizeList>(null);

  // Memoize the list of all TOPIC_ constants
  const quests = useMemo(() => {
    const constants = semanticModel.constants || {};
    return Object.values(constants).filter(c => c.name.startsWith('TOPIC_'));
  }, [semanticModel.constants]);

  // Analyze all quests once when model changes
  const questAnalysisMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof analyzeQuest>>();
    // To avoid blocking UI on large projects, we could debounce this or use a worker
    // But for now, we assume it's fast enough or React scheduling handles it
    quests.forEach(q => {
        map.set(q.name, analyzeQuest(semanticModel, q.name));
    });
    return map;
  }, [quests, semanticModel]);

  // Memoize the set of used topics to enable "Used" filtering
  const usedTopics = useMemo(() => {
    return getUsedQuestTopics(semanticModel);
  }, [semanticModel]);

  const filteredQuests = useMemo(() => {
    return quests.filter(q => {
      const analysis = questAnalysisMap.get(q.name);

      // Text Filter
      const matchesSearch = q.name.toLowerCase().includes(filter.toLowerCase()) ||
                            String(q.value).toLowerCase().includes(filter.toLowerCase());

      if (!matchesSearch) return false;

      // View Mode Filter
      if (viewMode === 'used' && !usedTopics.has(q.name)) {
        return false;
      }

      // Status Filter
      if (statusFilter !== 'all' && analysis?.status !== statusFilter) {
          return false;
      }

      return true;
    });
  }, [quests, filter, viewMode, statusFilter, usedTopics, questAnalysisMap]);

  const itemData = useMemo(() => ({
    filteredQuests,
    selectedQuest,
    onSelectQuest,
    questAnalysisMap,
    navigateToSymbol
  }), [filteredQuests, selectedQuest, onSelectQuest, questAnalysisMap, navigateToSymbol]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTo(0);
    }
  }, [filteredQuests]);

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
          sx={{ mb: 1 }}
        />

        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
             <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(_, mode) => mode && setViewMode(mode)}
              size="small"
              sx={{ flexGrow: 1 }}
            >
              <ToggleButton value="all" sx={{ flexGrow: 1 }}>All</ToggleButton>
              <ToggleButton value="used" sx={{ flexGrow: 1 }}>Used</ToggleButton>
            </ToggleButtonGroup>

            <FormControl size="small" sx={{ minWidth: 100 }}>
                <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    displayEmpty
                    variant="outlined"
                    inputProps={{ 'aria-label': 'Status Filter' }}
                    renderValue={(selected) => {
                        if (selected === 'all') return <FilterListIcon fontSize="small" />;
                        return getStatusIcon(selected);
                    }}
                >
                    <MenuItem value="all">All Statuses</MenuItem>
                    <MenuItem value="implemented"><Box sx={{display:'flex', gap:1}}><CheckIcon fontSize="small" color="success"/> Implemented</Box></MenuItem>
                    <MenuItem value="wip"><Box sx={{display:'flex', gap:1}}><BuildIcon fontSize="small" color="info"/> In Progress</Box></MenuItem>
                    <MenuItem value="not_started"><Box sx={{display:'flex', gap:1}}><HourglassEmptyIcon fontSize="small" color="disabled"/> Not Started</Box></MenuItem>
                    <MenuItem value="broken"><Box sx={{display:'flex', gap:1}}><ReportIcon fontSize="small" color="error"/> Broken</Box></MenuItem>
                </Select>
            </FormControl>
        </Box>
      </Box>
      <Divider />

      <Box sx={{ flexGrow: 1 }}>
        {filteredQuests.length > 0 ? (
          <AutoSizer>
            {({ height, width }) => (
              <FixedSizeList
                ref={listRef}
                height={height}
                width={width}
                itemCount={filteredQuests.length}
                itemSize={72}
                itemData={itemData}
                // @ts-ignore - role is passed to outer element
                role="list"
              >
                {Row}
              </FixedSizeList>
            )}
          </AutoSizer>
        ) : (
           <List sx={{ flexGrow: 1, overflow: 'auto' }}>
            <ListItem>
              <ListItemText secondary="No quests found" sx={{ textAlign: 'center', fontStyle: 'italic', color: 'text.secondary' }} />
            </ListItem>
          </List>
        )}
      </Box>

      <CreateQuestDialog open={isCreateDialogOpen} onClose={() => setIsCreateDialogOpen(false)} />
    </Box>
  );
};

export default QuestList;
