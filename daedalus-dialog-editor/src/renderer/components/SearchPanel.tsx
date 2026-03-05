/**
 * SearchPanel component - combines SearchBar and SearchResults in a collapsible panel
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { Box, Paper, IconButton, Collapse, Typography, Tooltip } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import SearchBar from './SearchBar';
import SearchResults from './SearchResults';
import { useSearchStore, SearchResult } from '../store/searchStore';
import type { SemanticModel, DialogMetadata } from '../types/global';
import {
  SEARCHABLE_PANE_PATTERN,
  searchablePaneContentSx,
  searchablePaneFilterStripSx,
  searchablePaneHeaderSx,
  searchablePaneShellSx
} from './common/searchablePaneStyles';

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  semanticModel: SemanticModel;
  dialogIndex: Map<string, DialogMetadata[]>;
  onResultClick: (result: SearchResult) => void;
}

const SearchPanel: React.FC<SearchPanelProps> = ({
  isOpen,
  onClose,
  semanticModel,
  dialogIndex,
  onResultClick
}) => {
  const focusRef = useRef<(() => void) | null>(null);
  const { performSearch, clearSearch } = useSearchStore();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        focusRef.current?.();
      }, 100);
    }
  }, [isOpen]);

  const handleSearch = useCallback((query: string) => {
    if (query.trim()) {
      performSearch(semanticModel, dialogIndex);
    }
  }, [performSearch, semanticModel, dialogIndex]);

  const handleClose = useCallback(() => {
    clearSearch();
    onClose();
  }, [clearSearch, onClose]);

  const handleResultClick = useCallback((result: SearchResult) => {
    onResultClick(result);
  }, [onResultClick]);

  return (
    <Collapse in={isOpen}>
      <Paper
        data-ui-pattern={SEARCHABLE_PANE_PATTERN}
        elevation={2}
        sx={(theme) => ({
          ...searchablePaneShellSx(theme),
          position: 'absolute',
          top: 0,
          left: 250,
          right: 0,
          zIndex: 100,
          maxWidth: 500,
        })}
      >
        <Box sx={(theme) => ({ ...searchablePaneHeaderSx(theme), display: 'flex', alignItems: 'center', gap: 1 })}>
          <Typography variant='subtitle2' sx={{ flexGrow: 1 }}>
            Global Search
          </Typography>
          <Typography variant='caption' color='text.secondary'>
            Ctrl+F
          </Typography>
          <Tooltip title='Close search'>
            <IconButton
              size='small'
              onClick={handleClose}
              aria-label='Close search panel'
            >
              <CloseIcon fontSize='small' />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={searchablePaneFilterStripSx}>
          <SearchBar
            placeholder='Search dialogs, NPCs, text...'
            focusRef={focusRef}
            onSearch={handleSearch}
            debounceMs={300}
          />
        </Box>

        <Box sx={(theme) => ({ ...searchablePaneContentSx(theme), maxHeight: 350 })}>
          <SearchResults onResultClick={handleResultClick} maxHeight={350} />
        </Box>
      </Paper>
    </Collapse>
  );
};

export default SearchPanel;
