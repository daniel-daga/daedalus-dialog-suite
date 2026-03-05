/**
 * SearchResults component - displays search results with click-to-navigate
 */

import React, { useMemo } from 'react';
import {
  Box,
  ListItem,
  ListItemButton,
  Typography,
  Chip,
  CircularProgress,
  Paper
} from '@mui/material';
import {
  Person as PersonIcon,
  Chat as ChatIcon,
  Code as CodeIcon,
  FormatQuote as FormatQuoteIcon
} from '@mui/icons-material';
import { useSearchStore, SearchResult } from '../store/searchStore';
import { VariableSizeList, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  searchablePaneHeaderSx,
  searchablePaneRowButtonSx,
  searchablePaneShellSx
} from './common/searchablePaneStyles';

interface SearchResultsProps {
  onResultClick: (result: SearchResult) => void;
  maxHeight?: number | string;
}

const resultTypeConfig = {
  npc: {
    label: 'NPC',
    color: 'primary' as const,
    icon: PersonIcon
  },
  dialog: {
    label: 'Dialog',
    color: 'secondary' as const,
    icon: ChatIcon
  },
  function: {
    label: 'Function',
    color: 'info' as const,
    icon: CodeIcon
  },
  text: {
    label: 'Text',
    color: 'success' as const,
    icon: FormatQuoteIcon
  }
};

interface RowData {
  searchResults: SearchResult[];
  onResultClick: (result: SearchResult) => void;
}

const Row = ({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { searchResults, onResultClick } = data;
  const result = searchResults[index];
  const config = resultTypeConfig[result.type];
  const Icon = config.icon;

  return (
    <ListItem style={style} key={`${result.type}-${result.name}-${index}`} disablePadding component='div'>
      <ListItemButton
        onClick={() => onResultClick(result)}
        sx={(theme) => ({ ...searchablePaneRowButtonSx(theme), py: 1, height: '100%' })}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 1 }}>
          <Icon
            fontSize='small'
            color='action'
            sx={{ mt: 0.5, flexShrink: 0 }}
          />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography
                variant='body2'
                sx={{
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {result.match}
              </Typography>
              <Chip
                label={config.label}
                size='small'
                color={config.color}
                sx={{ height: 18, fontSize: '0.65rem' }}
              />
            </Box>
            {result.context && (
              <Typography
                variant='caption'
                color='text.secondary'
                sx={{
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {result.context}
              </Typography>
            )}
          </Box>
        </Box>
      </ListItemButton>
    </ListItem>
  );
};

const SearchResults: React.FC<SearchResultsProps> = ({
  onResultClick,
  maxHeight = 400
}) => {
  const { searchQuery, searchResults, isSearching } = useSearchStore();

  if (!searchQuery.trim()) {
    return null;
  }

  if (isSearching) {
    return (
      <Paper
        sx={(theme) => ({
          ...searchablePaneShellSx(theme),
          p: 2,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        })}
      >
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (searchResults.length === 0) {
    return (
      <Paper sx={(theme) => ({ ...searchablePaneShellSx(theme), p: 2 })}>
        <Typography variant='body2' color='text.secondary' align='center'>
          No results found for "{searchQuery}"
        </Typography>
      </Paper>
    );
  }

  const getItemSize = (index: number) => {
    const result = searchResults[index];
    return result.context ? 60 : 40;
  };

  const totalContentHeight = searchResults.reduce((acc, result) => {
    return acc + (result.context ? 60 : 40);
  }, 0);

  const maxH = typeof maxHeight === 'number' ? maxHeight : parseInt(maxHeight as string, 10) || 400;
  const HEADER_HEIGHT = 37;
  const availableListHeight = maxH - HEADER_HEIGHT;
  const listHeight = Math.min(availableListHeight, totalContentHeight);
  const containerHeight = Math.min(maxH, HEADER_HEIGHT + listHeight);

  const itemData = useMemo(() => ({
    searchResults,
    onResultClick
  }), [searchResults, onResultClick]);

  return (
    <Paper sx={(theme) => ({ ...searchablePaneShellSx(theme), height: containerHeight, overflow: 'hidden', display: 'flex', flexDirection: 'column' })}>
      <Box sx={(theme) => ({ ...searchablePaneHeaderSx(theme), flexShrink: 0, height: HEADER_HEIGHT, boxSizing: 'border-box', py: 1, px: 1 })}>
        <Typography variant='caption' color='text.secondary'>
          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{searchQuery}"
        </Typography>
      </Box>
      <Box sx={{ flexGrow: 1, width: '100%' }}>
        <AutoSizer disableHeight>
          {({ width }) => (
            <VariableSizeList
              height={listHeight}
              width={width}
              itemCount={searchResults.length}
              itemSize={getItemSize}
              itemData={itemData}
            >
              {Row}
            </VariableSizeList>
          )}
        </AutoSizer>
      </Box>
    </Paper>
  );
};

export default SearchResults;
