import React, { useMemo, useState } from 'react';
import {
  Box,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  TextField,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
  Tooltip,
  ListItemIcon,
  Select,
  MenuItem,
  FormControl,
  Paper
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
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as VirtualizedList, ListChildComponentProps, areEqual } from 'react-window';
import type { SemanticModel, GlobalConstant } from '../types/global';
import CreateQuestDialog from './CreateQuestDialog';
import { useNavigation } from '../hooks/useNavigation';
import { analyzeQuest, getUsedQuestTopics, QuestAnalysis } from './QuestEditor/questAnalysis';
import {
  DEFAULT_QUEST_TOPIC_FILTER_POLICY,
  getCanonicalQuestKey,
  isQuestTopicConstantByPolicy
} from '../utils/questIdentity';
import {
  SEARCHABLE_PANE_PATTERN,
  searchablePaneContentSx,
  searchablePaneFilterStripSx,
  searchablePaneHeaderSx,
  searchablePaneRowButtonSx,
  searchablePaneShellSx,
  searchablePaneTextFieldSx
} from './common/searchablePaneStyles';

interface QuestListProps {
  semanticModel: SemanticModel;
  selectedQuest: string | null;
  onSelectQuest: (questName: string) => void;
}

interface ItemData {
  filteredQuests: GlobalConstant[];
  questAnalysisMap: Map<string, QuestAnalysis>;
  selectedQuest: string | null;
  onSelectQuest: (questName: string) => void;
  navigateToSymbol: (symbolName: string, options?: { preferSource: boolean }) => void;
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'implemented': return <CheckIcon color='success' fontSize='small' />;
    case 'wip': return <BuildIcon color='info' fontSize='small' />;
    case 'broken': return <ReportIcon color='error' fontSize='small' />;
    case 'not_started': return <HourglassEmptyIcon color='disabled' fontSize='small' />;
    default: return <HourglassEmptyIcon color='disabled' fontSize='small' />;
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

const QuestRow = React.memo(({ index, style, data }: ListChildComponentProps<ItemData>) => {
  const { filteredQuests, questAnalysisMap, selectedQuest, onSelectQuest, navigateToSymbol } = data;
  const quest = filteredQuests[index];

  if (!quest) return null;

  const analysis = questAnalysisMap.get(quest.name);
  const status = analysis?.status || 'not_started';
  const isSelected = selectedQuest === quest.name;

  return (
    <ListItem
      style={style}
      component='div'
      role='listitem'
      disablePadding
      secondaryAction={
        <Tooltip title='Follow reference' arrow>
          <IconButton
            edge='end'
            size='small'
            onClick={(e) => {
              e.stopPropagation();
              navigateToSymbol(quest.name, { preferSource: true });
            }}
          >
            <OpenInNewIcon fontSize='small' />
          </IconButton>
        </Tooltip>
      }
    >
      <ListItemButton
        selected={isSelected}
        onClick={() => onSelectQuest(quest.name)}
        sx={(theme) => ({ ...searchablePaneRowButtonSx(theme), pr: 6 })}
      >
        <ListItemIcon sx={{ minWidth: 30 }}>
          <Tooltip title={getStatusTooltip(status)}>
            {getStatusIcon(status)}
          </Tooltip>
        </ListItemIcon>
        <ListItemText
          primary={String(quest.value).replace(/^"|"$/g, '')}
          secondary={quest.name}
          primaryTypographyProps={{ noWrap: true }}
          secondaryTypographyProps={{ noWrap: true, fontSize: '0.75rem' }}
        />
      </ListItemButton>
    </ListItem>
  );
}, areEqual);

const QuestList: React.FC<QuestListProps> = ({ semanticModel, selectedQuest, onSelectQuest }) => {
  const { navigateToSymbol } = useNavigation();
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState<'all' | 'used'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'broken' | 'wip' | 'implemented' | 'not_started'>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const quests = useMemo(() => {
    const constants = semanticModel.constants || {};
    return Object.values(constants).filter(c => isQuestTopicConstantByPolicy(c.name, DEFAULT_QUEST_TOPIC_FILTER_POLICY));
  }, [semanticModel.constants]);

  const questAnalysisMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof analyzeQuest>>();
    quests.forEach((q) => {
      map.set(q.name, analyzeQuest(semanticModel, q.name));
    });
    return map;
  }, [quests, semanticModel]);

  const usedTopics = useMemo(() => {
    return getUsedQuestTopics(semanticModel);
  }, [semanticModel]);

  const usedTopicKeys = useMemo(() => {
    return new Set(Array.from(usedTopics).map(topic => getCanonicalQuestKey(topic)));
  }, [usedTopics]);

  const filteredQuests = useMemo(() => {
    return quests.filter((q) => {
      const analysis = questAnalysisMap.get(q.name);

      const matchesSearch = q.name.toLowerCase().includes(filter.toLowerCase()) ||
        String(q.value).toLowerCase().includes(filter.toLowerCase());
      if (!matchesSearch) return false;

      if (viewMode === 'used' && !usedTopicKeys.has(getCanonicalQuestKey(q.name))) {
        return false;
      }

      if (statusFilter !== 'all' && analysis?.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [quests, filter, viewMode, statusFilter, usedTopicKeys, questAnalysisMap]);

  const itemData = useMemo<ItemData>(() => ({
    filteredQuests,
    questAnalysisMap,
    selectedQuest,
    onSelectQuest,
    navigateToSymbol
  }), [filteredQuests, questAnalysisMap, selectedQuest, onSelectQuest, navigateToSymbol]);

  return (
    <Paper
      data-ui-pattern={SEARCHABLE_PANE_PATTERN}
      sx={(theme) => ({ ...searchablePaneShellSx(theme), height: '100%', borderRight: 1, borderColor: 'divider' })}
      elevation={1}
    >
      <Box sx={searchablePaneHeaderSx}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant='h6'>Quests</Typography>
          <Tooltip title='Create New Quest'>
            <IconButton onClick={() => setIsCreateDialogOpen(true)} size='small'>
              <AddIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={(theme) => ({ ...searchablePaneFilterStripSx(theme), display: 'flex', flexDirection: 'column', gap: 1 })}>
        <TextField
          fullWidth
          size='small'
          placeholder='Search quests...'
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position='start'>
                <SearchIcon color='action' />
              </InputAdornment>
            ),
          }}
          sx={searchablePaneTextFieldSx}
        />

        <Box sx={{ display: 'flex', gap: 1 }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, mode) => mode && setViewMode(mode)}
            size='small'
            sx={{ flexGrow: 1 }}
          >
            <ToggleButton value='all' sx={{ flexGrow: 1 }}>All</ToggleButton>
            <ToggleButton value='used' sx={{ flexGrow: 1 }}>Used</ToggleButton>
          </ToggleButtonGroup>

          <FormControl size='small' sx={{ minWidth: 100 }}>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              displayEmpty
              variant='outlined'
              inputProps={{ 'aria-label': 'Status Filter' }}
              renderValue={(selected) => {
                if (selected === 'all') return <FilterListIcon fontSize='small' />;
                return getStatusIcon(selected);
              }}
            >
              <MenuItem value='all'>All Statuses</MenuItem>
              <MenuItem value='implemented'><Box sx={{ display: 'flex', gap: 1 }}><CheckIcon fontSize='small' color='success' /> Implemented</Box></MenuItem>
              <MenuItem value='wip'><Box sx={{ display: 'flex', gap: 1 }}><BuildIcon fontSize='small' color='info' /> In Progress</Box></MenuItem>
              <MenuItem value='not_started'><Box sx={{ display: 'flex', gap: 1 }}><HourglassEmptyIcon fontSize='small' color='disabled' /> Not Started</Box></MenuItem>
              <MenuItem value='broken'><Box sx={{ display: 'flex', gap: 1 }}><ReportIcon fontSize='small' color='error' /> Broken</Box></MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      <Box sx={searchablePaneContentSx} role='list'>
        {filteredQuests.length > 0 ? (
          <AutoSizer>
            {({ height, width }) => (
              <VirtualizedList
                height={height}
                width={width}
                itemCount={filteredQuests.length}
                itemSize={60}
                itemData={itemData}
              >
                {QuestRow}
              </VirtualizedList>
            )}
          </AutoSizer>
        ) : (
          <Box sx={{ p: 2, textAlign: 'center', fontStyle: 'italic', color: 'text.secondary' }}>
            No quests found
          </Box>
        )}
      </Box>

      <CreateQuestDialog open={isCreateDialogOpen} onClose={() => setIsCreateDialogOpen(false)} />
    </Paper>
  );
};

export default QuestList;


