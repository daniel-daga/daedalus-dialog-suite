/**
 * SearchPanel component - combines SearchBar and SearchResults in a collapsible panel
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { Box, Paper, IconButton, Collapse, Typography, Divider } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import SearchBar from './SearchBar';
import SearchResults from './SearchResults';
import { useSearchStore, SearchResult } from '../store/searchStore';
import type { SemanticModel, DialogMetadata } from '../types/global';

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

  // Focus the search input when panel opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready
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
    // Keep the panel open so user can click more results
  }, [onResultClick]);

  return (
    <Collapse in={isOpen}>
      <Paper
        elevation={2}
        sx={{
          position: 'absolute',
          top: 0,
          left: 250, // Positioned after NPC list
          right: 0,
          zIndex: 100,
          maxWidth: 500,
          borderRadius: 0,
          borderBottom: 1,
          borderColor: 'divider'
        }}
      >
        <Box sx={{ p: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              Global Search
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Ctrl+F
            </Typography>
            <IconButton size="small" onClick={handleClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <SearchBar
            placeholder="Search dialogs, NPCs, text..."
            focusRef={focusRef}
            onSearch={handleSearch}
            debounceMs={300}
          />
        </Box>
        <Divider />
        <Box sx={{ maxHeight: 350, overflow: 'auto' }}>
          <SearchResults onResultClick={handleResultClick} maxHeight={350} />
        </Box>
      </Paper>
    </Collapse>
  );
};

export default SearchPanel;
