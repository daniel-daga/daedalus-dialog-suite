import React, { useState, useRef, useCallback } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { Add as AddIcon, Chat as ChatIcon, CallSplit as CallSplitIcon, Description as DescriptionIcon, LibraryBooks as LibraryBooksIcon, SwapHoriz as SwapHorizIcon, Navigation as NavigationIcon, Code as CodeIcon, Inventory as InventoryIcon, CardGiftcard as CardGiftcardIcon, Gavel as GavelIcon, EmojiPeople as EmojiPeopleIcon, Edit as EditIcon, Stop as StopIcon, PlayArrow as PlayArrowIcon, Star as StarIcon, School as SchoolIcon, PersonAdd as PersonAddIcon, RemoveShoppingCart as RemoveShoppingCartIcon, Inventory2 as Inventory2Icon, DragIndicator as DragIndicatorIcon, Comment as CommentIcon } from '@mui/icons-material';
import { ActionCardProps } from './dialogTypes';
import { getRendererForAction, getActionTypeLabel } from './actionRenderers';
import { getActionType } from './actionTypes';
import type { ActionTypeId } from './actionTypes';
import type { BaseActionRendererProps } from './actionRenderers/types';
import { shallowEqual } from '../utils/shallowEqual';
import { registerPendingEditFlusher } from '../utils/pendingEditFlushRegistry';
import { actionPathToKey } from './nestedActionUtils';
import ActionTypeMenu from './common/ActionTypeMenu';
import DeleteConfirmDialog from './common/DeleteConfirmDialog';

const ActionCard = React.memo(React.forwardRef<HTMLInputElement, ActionCardProps>(({ action, path, index, totalActions, npcName, updateActionAtPath, deleteActionAtPath, focusActionAtPath, addDialogLineAfterPath, deleteActionAndFocusPrevAtPath, addActionAfterPath, addActionToBranchEnd, moveAction, registerActionRef, getVisibleActionPaths, onNavigateToFunction, onRenameFunction, dialogContextName, onEscapeBackward, droppableNamespace, dragHandleProps, filePath }, ref) => {
  const mainFieldRef = useRef<HTMLInputElement>(null);
  const actionBoxRef = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuSelectionMadeRef = useRef(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Local state for text input to avoid parent re-renders on every keystroke
  const [localAction, setLocalAction] = useState(action);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Set when this card's action has been deleted. Deleting moves focus to the
  // previous card synchronously — before React unmounts this card — which fires
  // a native blur on this card's field. Without the flag, that blur's
  // flushUpdate writes the deleted action back to its old path: re-appending it
  // (last line) or overwriting the line that shifted into the slot (data loss).
  const deletedRef = useRef(false);

  // Use refs to store latest values without triggering re-renders
  const localActionRef = useRef(localAction);
  const actionRef = useRef(action);
  const pathRef = useRef(path);
  const updateActionRef = useRef(updateActionAtPath);

  // Keep refs in sync with latest values
  React.useEffect(() => {
    localActionRef.current = localAction;
  }, [localAction]);

  React.useEffect(() => {
    pathRef.current = path;
  }, [path]);

  React.useEffect(() => {
    updateActionRef.current = updateActionAtPath;
  }, [updateActionAtPath]);

  // Sync local state when action prop changes from parent
  React.useEffect(() => {
    actionRef.current = action;
    setLocalAction(action);
  }, [action]);

  // Expose the ref to parent
  React.useImperativeHandle(ref, () => mainFieldRef.current!);

  // useLayoutEffect so ref registration (and any pending focus) is applied
  // synchronously during the commit phase, before the first paint.
  React.useLayoutEffect(() => {
    registerActionRef(path, mainFieldRef.current);
    return () => registerActionRef(path, null);
  }, [path, registerActionRef]);

  const flushUpdate = useCallback(() => {
    if (deletedRef.current) {
      return;
    }
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    if (shallowEqual(localActionRef.current, actionRef.current)) {
      return;
    }
    // Resolve path/action via refs, mirroring the debounce timer body and the
    // unmount flush. Select-type renderers call handleUpdate(...) then
    // flushUpdate() in the SAME tick; at that point the closure-captured
    // `localAction` is still the pre-change value (setLocalAction is async), so
    // a lexical write would commit the stale value and clear the timer that
    // would otherwise have committed the real one (0.2).
    updateActionRef.current(pathRef.current, localActionRef.current);
  }, []);

  const handleUpdate = useCallback((updated: typeof localAction) => {
    // Update local state immediately for responsive UI
    setLocalAction(updated);
    localActionRef.current = updated;

    // Debounce parent updates - only sync after user stops typing
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }
    updateTimerRef.current = setTimeout(() => {
      updateTimerRef.current = null;
      if (deletedRef.current) {
        return;
      }
      if (shallowEqual(localActionRef.current, actionRef.current)) {
        return;
      }
      // Resolve path/action via refs at fire time: the card's path may have
      // shifted while the debounce was pending (insertion above, undo, drag),
      // and a lexically captured path would write the text onto a sibling.
      updateActionRef.current(pathRef.current, localActionRef.current);
    }, 300); // 300ms debounce
  }, []);

  // Cleanup timer on unmount - use refs to avoid stale closures
  React.useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
        // Only flush if the local action actually differs from the last parent-synced action.
        // During drag-and-drop reorder, the component unmounts and remounts at a new index.
        // Without this guard the flush could write to a stale path, corrupting data.
        if (!shallowEqual(localActionRef.current, actionRef.current)) {
          updateActionRef.current(pathRef.current, localActionRef.current);
        }
      }
    };
  }, []); // Empty deps - cleanup function only created once, uses refs for latest values

  // Register a save/undo-time flusher (N4): a save within the 300 ms debounce
  // window must serialize the newest keystroke. No-ops unless a timer is live;
  // when it fires it commits the pending edit exactly as the timer body would.
  React.useEffect(() => {
    return registerPendingEditFlusher(() => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
        if (shallowEqual(localActionRef.current, actionRef.current)) {
          return;
        }
        updateActionRef.current(pathRef.current, localActionRef.current);
      }
    });
  }, []);

  const handleDelete = useCallback(() => {
    // Sync action ref so the unmount cleanup does not re-add via stale debounce diff
    actionRef.current = localActionRef.current;
    deleteActionAtPath(path);
  }, [deleteActionAtPath, path]);

  const handleTabToNext = useCallback(() => {
    const visiblePaths = getVisibleActionPaths();
    const currentIndex = visiblePaths.findIndex((candidate) => actionPathToKey(candidate) === actionPathToKey(path));
    const nextPath = currentIndex >= 0 ? visiblePaths[currentIndex + 1] : undefined;
    if (nextPath) {
      focusActionAtPath(nextPath);
    }
  }, [focusActionAtPath, getVisibleActionPaths, path]);

  const handleTabToPrev = useCallback(() => {
    const visiblePaths = getVisibleActionPaths();
    const currentIndex = visiblePaths.findIndex((candidate) => actionPathToKey(candidate) === actionPathToKey(path));
    const prevPath = currentIndex > 0 ? visiblePaths[currentIndex - 1] : undefined;
    if (prevPath) {
      focusActionAtPath(prevPath);
    } else if (currentIndex === 0 && onEscapeBackward) {
      // First card in the list, nowhere to go inside it: escape backward to the
      // container (choice sub-dialogs return focus to the Choice Text field —
      // issue #118, the reverse of the Tab-dive-in).
      onEscapeBackward();
    }
  }, [focusActionAtPath, getVisibleActionPaths, path, onEscapeBackward]);

  const handleAddNewAfter = useCallback((toggleSpeaker: boolean = true) => {
    addDialogLineAfterPath(path, toggleSpeaker);
  }, [addDialogLineAfterPath, path]);

  const handleDeleteAndFocusPrev = useCallback(() => {
    // Suppress the blur-flush fired when focus moves to the previous card
    // (still inside this keydown dispatch, before this card unmounts), and
    // cancel any pending debounce so it cannot write the deleted action back.
    deletedRef.current = true;
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    // Sync action ref so the unmount cleanup does not re-add via stale debounce diff
    actionRef.current = localActionRef.current;
    deleteActionAndFocusPrevAtPath(path);
  }, [deleteActionAndFocusPrevAtPath, path]);

  const handleAddActionAfter = useCallback((actionType: ActionTypeId) => {
    menuSelectionMadeRef.current = true;
    addActionAfterPath(path, actionType);
  }, [addActionAfterPath, path]);



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
    } else if (e.key === 'Escape') {
      e.preventDefault();
      flushUpdate();
      setDeleteConfirmOpen(true);
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
      case 'conditionalAction': return <CallSplitIcon fontSize="small" />;
      case 'commentAction': return <CommentIcon fontSize="small" />;
      case 'customAction': return <CodeIcon fontSize="small" />;
      default: return <CodeIcon fontSize="small" />;
    }
  };

  // Get the appropriate renderer for this action type
  const Renderer = getRendererForAction(localAction);

  // Prepare props for the renderer
  const rendererProps: BaseActionRendererProps = {
    action: localAction,
    path,
    index,
    totalActions,
    npcName,
    handleUpdate,
    handleDelete,
    flushUpdate,
    handleKeyDown,
    mainFieldRef,
    onNavigateToFunction,
    onRenameFunction,
    dialogContextName,
    droppableNamespace,
    updateActionAtPath,
    deleteActionAtPath,
    focusActionAtPath,
    addDialogLineAfterPath,
    deleteActionAndFocusPrevAtPath,
    addActionAfterPath,
    addActionToBranchEnd,
    moveAction,
    registerActionRef,
    getVisibleActionPaths,
    filePath
  };

  return (
    <Box
      ref={actionBoxRef}
      sx={{
        pt: 2,
        px: 0.5,
        pb: 2,
        borderBottom: '1px solid',
        borderColor: (theme) =>
          theme.palette.mode === 'dark'
            ? 'rgba(255, 255, 255, 0.2)'
            : 'rgba(0, 0, 0, 0.18)',
        position: 'relative',
        bgcolor: (theme) =>
          index % 2 === 1
            ? theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.03)'
              : 'rgba(0, 0, 0, 0.02)'
            : 'transparent',
      }}
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
        {dragHandleProps && (
          <Box
            {...dragHandleProps}
            sx={{
              display: 'flex',
              color: 'text.disabled',
              cursor: 'grab',
              flexShrink: 0,
              '&:hover': { color: 'text.secondary' },
              '&:active': { cursor: 'grabbing' }
            }}
          >
            <DragIndicatorIcon fontSize="small" />
          </Box>
        )}
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
      <ActionTypeMenu
        anchorEl={menuAnchor}
        onClose={() => {
          const wasSelection = menuSelectionMadeRef.current;
          menuSelectionMadeRef.current = false;
          setMenuAnchor(null);
          if (!wasSelection) {
            mainFieldRef.current?.focus();
          }
        }}
        onSelect={handleAddActionAfter}
      />

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          handleDeleteAndFocusPrev();
        }}
        onCancel={() => {
          setDeleteConfirmOpen(false);
          mainFieldRef.current?.focus();
        }}
      />

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
            }}
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setMenuAnchor(e.currentTarget);
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
  // Honest comparator (fix-07 §2.8 option iii). This intentionally ignores every
  // function prop and reads no model data, which is only safe because of two
  // invariants the owner guarantees:
  //   1. All function props crossing this boundary are identity-stable
  //      (ActionsList's owner wraps them via useStableHandlers), so a swapped
  //      handler implementation is picked up through the wrapper's ref without a
  //      re-render.
  //   2. Model data must NOT cross this boundary — renderers that need the
  //      semantic model read it from the store at the leaf (ChoiceRenderer via
  //      useResolvedFunction; VariableAutocomplete via useVariableOptions), so a
  //      memo-blocked card never shows stale model data.
  // Given those, the true render inputs are just the fields compared below.

  if (actionPathToKey(prevProps.path) !== actionPathToKey(nextProps.path)) return false;
  if (prevProps.index !== nextProps.index) return false;
  if (prevProps.totalActions !== nextProps.totalActions) return false;
  if (prevProps.npcName !== nextProps.npcName) return false;
  if (prevProps.dialogContextName !== nextProps.dialogContextName) return false;
  if (prevProps.filePath !== nextProps.filePath) return false;

  // Shallow comparison for action - only re-render if action data actually changed
  // This is faster than JSON.stringify for shallow objects like DialogAction
  return shallowEqual(prevProps.action, nextProps.action);
});

ActionCard.displayName = 'ActionCard';

export default ActionCard;
