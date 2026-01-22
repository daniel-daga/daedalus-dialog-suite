/**
 * SearchResults component - displays search results with click-to-navigate
 */

import React from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
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

const SearchResults: React.FC<SearchResultsProps> = ({
  onResultClick,
  maxHeight = 400
}) => {
  const { searchQuery, searchResults, isSearching } = useSearchStore();

  // Don't render if no search query
  if (!searchQuery.trim()) {
    return null;
  }

  // Show loading state
  if (isSearching) {
    return (
      <Paper
        sx={{
          p: 2,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}
      >
        <CircularProgress size={24} />
      </Paper>
    );
  }

  // Show no results message
  if (searchResults.length === 0) {
    return (
      <Paper sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary" align="center">
          No results found for "{searchQuery}"
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ maxHeight, overflow: 'auto' }}>
      <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{searchQuery}"
        </Typography>
      </Box>
      <List dense disablePadding>
        {searchResults.map((result, index) => {
          const config = resultTypeConfig[result.type];
          const Icon = config.icon;

          return (
            <ListItem key={`${result.type}-${result.name}-${index}`} disablePadding>
              <ListItemButton
                onClick={() => onResultClick(result)}
                sx={{ py: 1 }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 1 }}>
                  <Icon
                    fontSize="small"
                    color="action"
                    sx={{ mt: 0.5, flexShrink: 0 }}
                  />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography
                        variant="body2"
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
                        size="small"
                        color={config.color}
                        sx={{ height: 18, fontSize: '0.65rem' }}
                      />
                    </Box>
                    {result.context && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
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
        })}
      </List>
    </Paper>
  );
};

export default SearchResults;
