import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Popover, TextField, MenuItem, InputAdornment } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import type { ActionTypeId } from '../actionTypes';
import { ACTION_TYPE_REGISTRY, ADDABLE_ACTION_TYPES } from '../actionTypeRegistry';

const ACTION_TYPE_ITEMS: { type: ActionTypeId; label: string; icon: React.ReactNode }[] =
  ADDABLE_ACTION_TYPES.map((type) => {
    const { label, icon: Icon } = ACTION_TYPE_REGISTRY[type];
    return { type, label, icon: <Icon fontSize="small" /> };
  });

interface ActionTypeMenuProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onSelect: (actionType: ActionTypeId) => void;
  anchorOrigin?: {
    vertical: 'top' | 'center' | 'bottom';
    horizontal: 'left' | 'center' | 'right';
  };
  transformOrigin?: {
    vertical: 'top' | 'center' | 'bottom';
    horizontal: 'left' | 'center' | 'right';
  };
}

const ActionTypeMenu: React.FC<ActionTypeMenuProps> = ({
  anchorEl,
  onClose,
  onSelect,
  anchorOrigin = { vertical: 'bottom', horizontal: 'center' },
  transformOrigin = { vertical: 'top', horizontal: 'center' }
}) => {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const open = Boolean(anchorEl);

  useEffect(() => {
    if (open) {
      setFilter('');
      setSelectedIndex(0);
    }
  }, [open]);

  const filtered = filter
    ? ACTION_TYPE_ITEMS.filter((item) =>
        item.label.toLowerCase().includes(filter.toLowerCase())
      )
    : ACTION_TYPE_ITEMS;

  // Keep selectedIndex in bounds when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((actionType: ActionTypeId) => {
    onSelect(actionType);
    onClose();
  }, [onSelect, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) {
        handleSelect(filtered[selectedIndex].type);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [filtered, selectedIndex, handleSelect, onClose]);

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      slotProps={{
        paper: {
          sx: {
            mt: 1,
            boxShadow: 4,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            width: 280,
            overflow: 'hidden',
          }
        }
      }}
      disableAutoFocus={false}
      disableRestoreFocus
    >
      <Box sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <TextField
          inputRef={inputRef}
          autoFocus
          fullWidth
          size="small"
          placeholder="Search actions..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={handleKeyDown}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              </InputAdornment>
            ),
          }}
          sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.85rem' } }}
        />
      </Box>
      <Box
        ref={listRef}
        sx={{
          maxHeight: 300,
          overflowY: 'auto',
          py: 0.5,
        }}
      >
        {filtered.length === 0 ? (
          <Box sx={{ px: 2, py: 1.5, color: 'text.secondary', fontSize: '0.85rem' }}>
            No matching actions
          </Box>
        ) : (
          filtered.map((item, idx) => (
            <MenuItem
              key={item.type}
              selected={idx === selectedIndex}
              data-selected={idx === selectedIndex}
              onClick={() => handleSelect(item.type)}
              dense
              sx={{ gap: 1.5 }}
            >
              <Box sx={{ display: 'flex', color: 'text.secondary' }}>
                {item.icon}
              </Box>
              {item.label}
            </MenuItem>
          ))
        )}
      </Box>
    </Popover>
  );
};

export default ActionTypeMenu;
