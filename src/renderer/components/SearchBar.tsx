/**
 * SearchBar component - provides search input with debouncing
 */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { TextField, InputAdornment, IconButton } from '@mui/material';
import { Search as SearchIcon, Clear as ClearIcon } from '@mui/icons-material';
import { useSearchStore } from '../store/searchStore';
import { debounce } from '../utils/debounce';

interface SearchBarProps {
  placeholder?: string;
  onSearch?: (query: string) => void;
  focusRef?: { current: (() => void) | null };
  debounceMs?: number;
}

const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = 'Search dialogs...',
  onSearch,
  focusRef,
  debounceMs = 300
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { searchQuery, setSearchQuery, clearSearch } = useSearchStore();

  // Debounced search callback
  const debouncedOnSearch = useMemo(
    () => onSearch ? debounce(onSearch, debounceMs) : null,
    [onSearch, debounceMs]
  );

  // Expose focus function via ref
  useEffect(() => {
    if (focusRef) {
      focusRef.current = () => {
        inputRef.current?.focus();
      };
    }
  }, [focusRef]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    debouncedOnSearch?.(value);
  }, [setSearchQuery, debouncedOnSearch]);

  const handleClear = useCallback(() => {
    clearSearch();
    onSearch?.('');
    inputRef.current?.focus();
  }, [clearSearch, onSearch]);

  return (
    <TextField
      inputRef={inputRef}
      size="small"
      fullWidth
      placeholder={placeholder}
      value={searchQuery}
      onChange={handleChange}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" color="action" data-testid="SearchIcon" />
          </InputAdornment>
        ),
        endAdornment: searchQuery ? (
          <InputAdornment position="end">
            <IconButton
              size="small"
              onClick={handleClear}
              aria-label="clear"
              edge="end"
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </InputAdornment>
        ) : null
      }}
      sx={{
        '& .MuiOutlinedInput-root': {
          backgroundColor: 'background.paper'
        }
      }}
    />
  );
};

export default SearchBar;
