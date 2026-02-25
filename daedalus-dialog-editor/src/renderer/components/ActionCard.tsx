import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Box, Tooltip, Typography, Menu, MenuItem } from '@mui/material';
import { Add as AddIcon, Chat as ChatIcon, CallSplit as CallSplitIcon, Description as DescriptionIcon, LibraryBooks as LibraryBooksIcon, SwapHoriz as SwapHorizIcon, Navigation as NavigationIcon, Code as CodeIcon, Inventory as InventoryIcon, CardGiftcard as CardGiftcardIcon, Gavel as GavelIcon, EmojiPeople as EmojiPeopleIcon, Edit as EditIcon, Stop as StopIcon, PlayArrow as PlayArrowIcon, Star as StarIcon, School as SchoolIcon, PersonAdd as PersonAddIcon, RemoveShoppingCart as RemoveShoppingCartIcon, Inventory2 as Inventory2Icon } from '@mui/icons-material';
import { ActionCardProps } from './dialogTypes';
import { getRendererForAction, getActionTypeLabel } from './actionRenderers';
import { getActionType } from './actionTypes';
import type { ActionTypeId } from './actionTypes';
import type { BaseActionRendererProps } from './actionRenderers/types';
import { shallowEqual } from '../utils/shallowEqual';

const ActionCard = React.memo(React.forwardRef<HTMLInputElement, ActionCardProps>(({ action, index, totalActions, npcName, updateAction, deleteAction, focusAction, addDialogLineAfter, deleteActionAndFocusPrev, addActionAfter, semanticModel, onNavigateToFunction, onRenameFunction, dialogContextName }, ref) => {
  const mainFieldRef = useRef<HTMLInputElement>(null);
  const actionBoxRef = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedMenuIndex, setSelectedMenuIndex] = useState(0);
  const [hasFocus, setHasFocus] = useState(false);

  // Local state for text input to avoid parent re-renders on every keystroke
  const [localAction, setLocalAction] = useState(action);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Use refs to store latest values without triggering re-renders
  const localActionRef = useRef(localAction);
  const indexRef = useRef(index);
  const updateActionRef = useRef(updateAction);

  // Keep refs in sync with latest values
  React.useEffect(() => {
    localActionRef.current = localAction;
  }, [localAction]);

  React.useEffect(() => {
    indexRef.current = index;
  }, [index]);

  React.useEffect(() => {
    updateActionRef.current = updateAction;
  }, [updateAction]);

  // Sync local state when action prop changes from parent
  React.useEffect(() => {
    setLocalAction(action);
  }, [action]);

  // Expose the ref to parent
  React.useImperativeHandle(ref, () => mainFieldRef.current!);

  const flushUpdate = useCallback(() => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    // Sync local state to parent immediately
    updateAction(index, localAction);
  }, [updateAction, index, localAction]);

  const handleUpdate = useCallback((updated: typeof localAction) => {
    // Update local state immediately for responsive UI
    setLocalAction(updated);

    // Debounce parent updates - only sync after user stops typing
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }
    updateTimerRef.current = setTimeout(() => {
      updateAction(index, updated);
      updateTimerRef.current = null;
    }, 300); // 300ms debounce
  }, [updateAction, index]);

  // Cleanup timer on unmount - use refs to avoid stale closures
  React.useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        // Flush using refs to get latest values and avoid data corruption
        // This ensures we use the current index/action, not stale values from closure
        updateActionRef.current(indexRef.current, localActionRef.current);
      }
    };
  }, []); // Empty deps - cleanup function only created once, uses refs for latest values

  const handleDelete = useCallback(() => {
    deleteAction(index);
  }, [deleteAction, index]);

  const handleTabToNext = useCallback(() => {
    const nextIdx = index + 1;
    if (nextIdx < totalActions) {
      focusAction(nextIdx);
    }
  }, [focusAction, index, totalActions]);

  const handleTabToPrev = useCallback(() => {
    const prevIdx = index - 1;
    if (prevIdx >= 0) {
      focusAction(prevIdx);
    }
  }, [focusAction, index]);

  const handleAddNewAfter = useCallback((toggleSpeaker: boolean = true) => {
    addDialogLineAfter(index, toggleSpeaker);
  }, [addDialogLineAfter, index]);

  const handleDeleteAndFocusPrev = useCallback(() => {
    deleteActionAndFocusPrev(index);
  }, [deleteActionAndFocusPrev, index]);

  const handleAddActionAfter = useCallback((actionType: ActionTypeId) => {
    addActionAfter(index, actionType);
  }, [addActionAfter, index]);



  const hasNonEmptyText = useCallback((value: typeof localAction): boolean => {
    return 'text' in value && typeof value.text === 'string' && value.text.trim() !== '';
  }, []);
  // Determine action type for conditional logic
  const actionType = getActionType(localAction);
  const isDialogLine = actionType === 'dialogLine';

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't process any keys if menu is open (menu will handle them)
    if (menuAnchor) {
      return;
    }

    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      flushUpdate();
      handleTabToNext();
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      flushUpdate();
      handleTabToPrev();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      // Ctrl+Enter opens the action dropdown menu
      e.preventDefault();
      flushUpdate();
      setMenuAnchor(actionBoxRef.current);
      setSelectedMenuIndex(0);
    } else if (e.key === 'Enter' && e.shiftKey && isDialogLine && hasNonEmptyText(localAction)) {
      // Shift+Enter creates a new dialog line WITHOUT toggling speaker
      e.preventDefault();
      flushUpdate();
      handleAddNewAfter(false);
    } else if (e.key === 'Enter' && isDialogLine && hasNonEmptyText(localAction)) {
      // Enter creates a new dialog line WITH toggling speaker (default behavior)
      e.preventDefault();
      flushUpdate();
      handleAddNewAfter(true);
    } else if (e.key === 'Backspace' && isDialogLine && !hasNonEmptyText(localAction)) {
      e.preventDefault();
      handleDeleteAndFocusPrev();
    }
  }, [menuAnchor, isDialogLine, localAction, flushUpdate, handleTabToNext, handleTabToPrev, handleAddNewAfter, handleDeleteAndFocusPrev, hasNonEmptyText]);

  const getActionIcon = () => {
    switch (actionType) {
      case 'dialogLine': return <ChatIcon fontSize="small" />;
      case 'choice': return <CallSplitIcon fontSize="small" />;
      case 'createTopic': return <LibraryBooksIcon fontSize="small" />;
      case 'logEntry': return <DescriptionIcon fontSize="small" />;
      case 'logSetTopicStatus': return <DescriptionIcon fontSize="small" />;
      case 'createInventoryItems': return <InventoryIcon fontSize="small" />;
      case 'giveInventoryItems': return <CardGiftcardIcon fontSize="small" />;
      case 'attackAction': return <GavelIcon fontSize="small" />;
      case 'setAttitudeAction': return <EmojiPeopleIcon fontSize="small" />;
      case 'chapterTransition': return <NavigationIcon fontSize="small" />;
      case 'exchangeRoutine': return <SwapHorizIcon fontSize="small" />;
      case 'setVariableAction': return <EditIcon fontSize="small" />;
      case 'stopProcessInfosAction': return <StopIcon fontSize="small" />;
      case 'playAniAction': return <PlayArrowIcon fontSize="small" />;
      case 'givePlayerXPAction': return <StarIcon fontSize="small" />;
      case 'pickpocketAction': return <GavelIcon fontSize="small" />;
      case 'startOtherRoutineAction': return <SwapHorizIcon fontSize="small" />;
      case 'teachAction': return <SchoolIcon fontSize="small" />;
      case 'giveTradeInventoryAction': return <Inventory2Icon fontSize="small" />;
      case 'removeInventoryItemsAction': return <RemoveShoppingCartIcon fontSize="small" />;
      case 'insertNpcAction': return <PersonAddIcon fontSize="small" />;
      case 'customAction': return <CodeIcon fontSize="small" />;
      default: return <CodeIcon fontSize="small" />;
    }
  };

  const actionTypes = useMemo<{ type: ActionTypeId; label: string; icon: React.ReactNode }[]>(() => [
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
    { type: 'playAniAction', label: 'Play Animation', icon: <PlayArrowIcon fontSize="small" /> },
    { type: 'givePlayerXPAction', label: 'Give XP', icon: <StarIcon fontSize="small" /> },
    { type: 'pickpocketAction', label: 'Pickpocket', icon: <GavelIcon fontSize="small" /> },
    { type: 'startOtherRoutineAction', label: 'Start Other Routine', icon: <SwapHorizIcon fontSize="small" /> },
    { type: 'teachAction', label: 'Teach', icon: <SchoolIcon fontSize="small" /> },
    { type: 'giveTradeInventoryAction', label: 'Give Trade Inventory', icon: <Inventory2Icon fontSize="small" /> },
    { type: 'removeInventoryItemsAction', label: 'Remove Inventory Items', icon: <RemoveShoppingCartIcon fontSize="small" /> },
    { type: 'insertNpcAction', label: 'Insert NPC', icon: <PersonAddIcon fontSize="small" /> },
    { type: 'customAction', label: 'Custom Action', icon: <CodeIcon fontSize="small" /> },
  ], []);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedMenuIndex((prev) => (prev + 1) % actionTypes.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedMenuIndex((prev) => (prev - 1 + actionTypes.length) % actionTypes.length);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMenuAnchor(null);
      mainFieldRef.current?.focus();
    }
  }, [actionTypes]);

  // Get the appropriate renderer for this action type
  const Renderer = getRendererForAction(localAction);

  // Prepare props for the renderer
  const rendererProps: BaseActionRendererProps = {
    action: localAction,
    index,
    totalActions,
    npcName,
    handleUpdate,
    handleDelete,
    flushUpdate,
    handleKeyDown,
    mainFieldRef,
    semanticModel,
    onNavigateToFunction,
    onRenameFunction,
    dialogContextName
  };

  return (
    <Box
      ref={actionBoxRef}
      sx={{ pb: 2, mb: 2, borderBottom: '1px solid', borderColor: 'divider', position: 'relative' }}
      onFocus={(e) => {
        // Only set focus if the target is an input/select element
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.getAttribute('role') === 'combobox') {
          setHasFocus(true);
        }
      }}
      onBlur={(e) => {
        // Only clear focus state if focus is leaving the entire action box
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setHasFocus(false);
        }
      }}
    >
      {/* Action type icon and renderer */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title={getActionTypeLabel(localAction)} arrow>
          <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
            {getActionIcon()}
          </Box>
        </Tooltip>
        <Box sx={{ flex: 1 }}>
          <Renderer {...rendererProps} />
        </Box>
      </Box>

      {/* Action Type Selection Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => {
          setMenuAnchor(null);
          mainFieldRef.current?.focus();
        }}
        onKeyDown={handleMenuKeyDown}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              boxShadow: 2,
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              minWidth: 200
            }
          }
        }}
        MenuListProps={{
          dense: true,
          sx: {
            outline: 'none',
            py: 1
          }
        }}
      >
        {actionTypes.map((actionType, idx) => (
          <MenuItem
            key={actionType.type}
            selected={idx === selectedMenuIndex}
            onClick={() => {
              handleAddActionAfter(actionType.type);
              setMenuAnchor(null);
            }}
            sx={{ gap: 1.5 }}
          >
            <Box sx={{ display: 'flex', color: 'text.secondary' }}>
              {actionType.icon}
            </Box>
            {actionType.label}
          </MenuItem>
        ))}
      </Menu>

      {/* "+" button in divider */}
      <Box
        sx={{
          position: 'absolute',
          bottom: -16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1
        }}
      >
        <Tooltip title="Add new action">
          <Box
            role="button"
            aria-label="Add new action"
            tabIndex={0}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '16px',
              height: '32px',
              px: 1,
              boxShadow: 1,
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                bgcolor: 'action.hover',
                borderColor: 'primary.main',
                boxShadow: 2
              },
              cursor: 'pointer'
            }}
            onClick={(e) => {
              e.stopPropagation();
              setMenuAnchor(e.currentTarget);
              setSelectedMenuIndex(0);
            }}
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setMenuAnchor(e.currentTarget);
                setSelectedMenuIndex(0);
              }
            }}
          >
            <AddIcon fontSize="small" sx={{ color: 'primary.main' }} />
            {hasFocus && (
            <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
              Ctrl+Enter
            </Typography>
          )}
          </Box>
        </Tooltip>
      </Box>
    </Box>
  );
}), (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  // Compare by action ID and check if action content is deeply equal
  // This prevents re-renders when only function props change (which happens often)

  if (prevProps.index !== nextProps.index) return false;
  if (prevProps.totalActions !== nextProps.totalActions) return false;
  if (prevProps.npcName !== nextProps.npcName) return false;
  if (prevProps.dialogContextName !== nextProps.dialogContextName) return false;

  // Shallow comparison for action - only re-render if action data actually changed
  // This is faster than JSON.stringify for shallow objects like DialogAction
  return shallowEqual(prevProps.action, nextProps.action);
});

ActionCard.displayName = 'ActionCard';

export default ActionCard;
