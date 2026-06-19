import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Popover, TextField, MenuItem, InputAdornment } from '@mui/material';
import {
  Search as SearchIcon,
  Chat as ChatIcon,
  CallSplit as CallSplitIcon,
  Description as DescriptionIcon,
  LibraryBooks as LibraryBooksIcon,
  Inventory as InventoryIcon,
  CardGiftcard as CardGiftcardIcon,
  Gavel as GavelIcon,
  EmojiPeople as EmojiPeopleIcon,
  Navigation as NavigationIcon,
  SwapHoriz as SwapHorizIcon,
  Code as CodeIcon,
  Edit as EditIcon,
  Stop as StopIcon,
  Block as BlockIcon,
  PlaylistRemove as PlaylistRemoveIcon,
  PlayArrow as PlayArrowIcon,
  Star as StarIcon,
  School as SchoolIcon,
  PersonAdd as PersonAddIcon,
  RemoveShoppingCart as RemoveShoppingCartIcon,
  Inventory2 as Inventory2Icon,
  DirectionsWalk as DirectionsWalkIcon
} from '@mui/icons-material';
import type { ActionTypeId } from '../actionTypes';

const ACTION_TYPE_ITEMS: { type: ActionTypeId; label: string; icon: React.ReactNode }[] = [
  { type: 'dialogLine', label: 'Dialog Line', icon: <ChatIcon fontSize="small" /> },
  { type: 'choice', label: 'Choice', icon: <CallSplitIcon fontSize="small" /> },
  { type: 'logEntry', label: 'Log Entry', icon: <DescriptionIcon fontSize="small" /> },
  { type: 'createTopic', label: 'Create Topic', icon: <LibraryBooksIcon fontSize="small" /> },
  { type: 'logSetTopicStatus', label: 'Log Set Status', icon: <DescriptionIcon fontSize="small" /> },
  { type: 'createInventoryItems', label: 'Create Inventory Items', icon: <InventoryIcon fontSize="small" /> },
  { type: 'giveInventoryItems', label: 'Give Inventory Items', icon: <CardGiftcardIcon fontSize="small" /> },
  { type: 'attackAction', label: 'Attack Action', icon: <GavelIcon fontSize="small" /> },
  { type: 'setAttitudeAction', label: 'Set Attitude', icon: <EmojiPeopleIcon fontSize="small" /> },
  { type: 'chapterTransition', label: 'Chapter Transition', icon: <NavigationIcon fontSize="small" /> },
  { type: 'exchangeRoutine', label: 'Exchange Routine', icon: <SwapHorizIcon fontSize="small" /> },
  { type: 'setVariableAction', label: 'Set Variable', icon: <EditIcon fontSize="small" /> },
  { type: 'stopProcessInfosAction', label: 'End Dialog', icon: <StopIcon fontSize="small" /> },
  { type: 'setRefuseTalkAction', label: 'Refuse Talk', icon: <BlockIcon fontSize="small" /> },
  { type: 'clearChoicesAction', label: 'Clear Choices', icon: <PlaylistRemoveIcon fontSize="small" /> },
  { type: 'playAniAction', label: 'Play Animation', icon: <PlayArrowIcon fontSize="small" /> },
  { type: 'givePlayerXPAction', label: 'Give XP', icon: <StarIcon fontSize="small" /> },
  { type: 'pickpocketAction', label: 'Pickpocket', icon: <GavelIcon fontSize="small" /> },
  { type: 'startOtherRoutineAction', label: 'Start Other Routine', icon: <SwapHorizIcon fontSize="small" /> },
  { type: 'teachAction', label: 'Teach', icon: <SchoolIcon fontSize="small" /> },
  { type: 'giveTradeInventoryAction', label: 'Give Trade Inventory', icon: <Inventory2Icon fontSize="small" /> },
  { type: 'removeInventoryItemsAction', label: 'Remove Inventory Items', icon: <RemoveShoppingCartIcon fontSize="small" /> },
  { type: 'insertNpcAction', label: 'Insert NPC', icon: <PersonAddIcon fontSize="small" /> },
  { type: 'heroFollowsAction', label: 'Hero Follows NPC', icon: <DirectionsWalkIcon fontSize="small" /> },
  { type: 'conditionalAction', label: 'If / Else Block', icon: <CallSplitIcon fontSize="small" /> },
  { type: 'customAction', label: 'Custom Action', icon: <CodeIcon fontSize="small" /> },
];

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
