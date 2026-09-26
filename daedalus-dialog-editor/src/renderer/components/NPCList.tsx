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
  Tooltip
} from '@mui/material';
import {
  FilterList as FilterListIcon,
  Clear as ClearIcon,
  Edit as EditIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { NPCListProps } from './dialogTypes';
import { useSearchStore } from '../store/searchStore';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  SEARCHABLE_PANE_PATTERN,
  searchablePaneContentSx,
  searchablePaneFilterStripSx,
  searchablePaneHeaderSx,
  searchablePaneRowButtonSx,
  searchablePaneShellSx,
  searchablePaneTextFieldSx
} from './common/searchablePaneStyles';

const Row = ({ index, style, data }: ListChildComponentProps) => {
  const { filteredNpcs, selectedNPC, onSelectNPC, npcMap, canEditNPC, onEditNPC } = data;
  const npc = filteredNpcs[index];
  const editable = !!onEditNPC && !!canEditNPC?.(npc);

  return (
    <ListItem
      style={style}
      key={npc}
      disablePadding
      component='div'
      secondaryAction={editable ? (
        <Tooltip title='Edit NPC'>
          <IconButton edge='end' size='small' aria-label={`Edit NPC ${npc}`} onClick={() => onEditNPC(npc)}>
            <EditIcon fontSize='small' />
          </IconButton>
        </Tooltip>
      ) : undefined}
    >
      <ListItemButton
        selected={selectedNPC === npc}
        onClick={() => onSelectNPC(npc)}
        sx={(theme) => ({ ...searchablePaneRowButtonSx(theme), height: '100%' })}
      >
        <ListItemText
          primary={npc}
          secondary={`${npcMap.get(npc)?.length || 0} dialog(s)`}
        />
      </ListItemButton>
    </ListItem>
  );
};

const NPCList: React.FC<NPCListProps> = ({ npcs, npcMap, selectedNPC, onSelectNPC, coverageNote, canEditNPC, onEditNPC, onCreateNPC }) => {
  const npcFilter = useSearchStore((s) => s.npcFilter);
  const setNpcFilter = useSearchStore((s) => s.setNpcFilter);
  const filterNpcs = useSearchStore((s) => s.filterNpcs);

  const filteredNpcs = useMemo(() => {
    return filterNpcs(npcs);
  }, [npcs, filterNpcs, npcFilter]);

  const itemData = useMemo(() => ({
    filteredNpcs,
    selectedNPC,
    onSelectNPC,
    npcMap,
    canEditNPC,
    onEditNPC
  }), [filteredNpcs, selectedNPC, onSelectNPC, npcMap, canEditNPC, onEditNPC]);

  const handleClear = () => {
    setNpcFilter('');
  };

  return (
    <Paper
      data-ui-pattern={SEARCHABLE_PANE_PATTERN}
      sx={(theme) => ({ ...searchablePaneShellSx(theme), width: 250, height: '100%', flexShrink: 0 })}
      elevation={1}
    >
      <Box sx={searchablePaneHeaderSx}>
        {/* The former "Add NPC" button was removed (issue #141): it created
            NPC instances with parameters of its own, which a mod need not
            define. "New NPC" (#285) copies an NPC the project already has
            instead. */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant='h6'>NPCs</Typography>
          {onCreateNPC && (
            <Tooltip title='New NPC (a copy of an existing one)'>
              <IconButton size='small' aria-label='New NPC' onClick={onCreateNPC}>
                <AddIcon fontSize='small' />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Typography variant='caption' color='text.secondary'>
          {filteredNpcs.length} of {npcs.length} shown
        </Typography>
        {coverageNote && (
          <Typography variant='caption' color='warning.main' sx={{ display: 'block' }}>
            {coverageNote}
          </Typography>
        )}
      </Box>

      <Box sx={searchablePaneFilterStripSx}>
        <TextField
          size='small'
          fullWidth
          placeholder='Filter NPCs...'
          value={npcFilter}
          onChange={(e) => setNpcFilter(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position='start'>
                <FilterListIcon fontSize='small' color='action' />
              </InputAdornment>
            ),
            endAdornment: npcFilter ? (
              <InputAdornment position='end'>
                <Tooltip title='Clear filter'>
                  <IconButton
                    size='small'
                    onClick={handleClear}
                    aria-label='Clear filter'
                    edge='end'
                  >
                    <ClearIcon fontSize='small' />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ) : null
          }}
          sx={searchablePaneTextFieldSx}
        />
      </Box>

      <Box sx={searchablePaneContentSx}>
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
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant='body2' color='text.secondary'>
              {npcFilter
                ? `No NPCs match "${npcFilter}"`
                : 'No NPCs yet. Place an NPC .d file in the project folder — the editor picks it up and creates its EXIT dialog file.'}
            </Typography>
          </Box>
        )}
      </Box>

    </Paper>
  );
};

export default NPCList;

