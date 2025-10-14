import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Box, TextField, IconButton, Tooltip, FormControl, InputLabel, Select, MenuItem, Typography, Menu, Stack } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Info as InfoIcon, Chat as ChatIcon, CallSplit as CallSplitIcon, Description as DescriptionIcon, LibraryBooks as LibraryBooksIcon, SwapHoriz as SwapHorizIcon, Navigation as NavigationIcon, Code as CodeIcon, HelpOutline as HelpOutlineIcon, Edit as EditIcon, Badge, Inventory as InventoryIcon, CardGiftcard as CardGiftcardIcon, Gavel as GavelIcon, EmojiPeople as EmojiPeopleIcon } from '@mui/icons-material';
import { ActionCardProps } from './dialogTypes';
import { validateChoiceFunctionName } from './dialogUtils';

const ActionCard = React.memo(React.forwardRef<HTMLInputElement, ActionCardProps>(({ action, index, totalActions, npcName, updateAction, deleteAction, focusAction, addDialogLineAfter, deleteActionAndFocusPrev, addActionAfter, semanticModel, onNavigateToFunction, onRenameFunction, dialogContextName }, ref) => {
  const mainFieldRef = useRef<HTMLInputElement>(null);
  const actionBoxRef = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedMenuIndex, setSelectedMenuIndex] = useState(0);
  const [hasFocus, setHasFocus] = useState(false);

  // Local state for text input to avoid parent re-renders on every keystroke
  const [localAction, setLocalAction] = useState(action);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  const handleUpdate = useCallback((updated: any) => {
    // Update local state immediately for responsive UI
    setLocalAction(updated);
    // Don't update parent during typing - only on flush
  }, []);

  // Cleanup timer on unmount and flush pending updates
  React.useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

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

  const handleAddNewAfter = useCallback(() => {
    addDialogLineAfter(index);
  }, [addDialogLineAfter, index]);

  const handleDeleteAndFocusPrev = useCallback(() => {
    deleteActionAndFocusPrev(index);
  }, [deleteActionAndFocusPrev, index]);

  const handleAddActionAfter = useCallback((actionType: string) => {
    addActionAfter(index, actionType);
  }, [addActionAfter, index]);

  // Determine action type
  const isDialogLine = localAction.speaker !== undefined && localAction.text !== undefined && localAction.id !== undefined;
  const isChoice = localAction.dialogRef !== undefined && localAction.targetFunction !== undefined;
  const isCreateTopic = localAction.topic !== undefined && localAction.topicType !== undefined && !localAction.status;
  const isLogEntry = localAction.topic !== undefined && localAction.text !== undefined && !localAction.topicType;
  const isLogSetTopicStatus = localAction.topic !== undefined && localAction.status !== undefined;
  const isCreateInventoryItems = localAction.target !== undefined && localAction.item !== undefined && localAction.quantity !== undefined && localAction.giver === undefined && localAction.receiver === undefined;
  const isGiveInventoryItems = localAction.giver !== undefined && localAction.receiver !== undefined && localAction.item !== undefined && localAction.quantity !== undefined;
  const isAttackAction = localAction.attacker !== undefined && localAction.target !== undefined && localAction.attackReason !== undefined && localAction.damage !== undefined;
  const isSetAttitudeAction = localAction.target !== undefined && localAction.attitude !== undefined && localAction.routine === undefined;
  const isChapterTransition = localAction.chapter !== undefined && localAction.world !== undefined;
  const isExchangeRoutine = (localAction.npc !== undefined || localAction.target !== undefined) && localAction.routine !== undefined && localAction.attitude === undefined;
  const isAction = localAction.action !== undefined;
  const isUnknown = !isDialogLine && !isChoice && !isCreateTopic && !isLogEntry && !isLogSetTopicStatus && !isCreateInventoryItems && !isGiveInventoryItems && !isAttackAction && !isSetAttitudeAction && !isChapterTransition && !isExchangeRoutine && !isAction;

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
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      flushUpdate();
      setMenuAnchor(actionBoxRef.current);
      setSelectedMenuIndex(0);
    } else if (e.key === 'Enter' && isDialogLine && localAction.text && localAction.text.trim() !== '') {
      e.preventDefault();
      flushUpdate();
      handleAddNewAfter();
    } else if (e.key === 'Backspace' && isDialogLine && (!localAction.text || localAction.text.trim() === '')) {
      e.preventDefault();
      handleDeleteAndFocusPrev();
    }
  }, [menuAnchor, isDialogLine, localAction.text, flushUpdate, handleTabToNext, handleTabToPrev, handleAddNewAfter, handleDeleteAndFocusPrev]);

  const getActionTypeLabel = () => {
    if (isDialogLine) return 'Dialog Line';
    if (isChoice) return 'Choice';
    if (isCreateTopic) return 'Create Topic';
    if (isLogEntry) return 'Log Entry';
    if (isLogSetTopicStatus) return 'Log Set Status';
    if (isCreateInventoryItems) return 'Create Inventory Items';
    if (isGiveInventoryItems) return 'Give Inventory Items';
    if (isAttackAction) return 'Attack Action';
    if (isSetAttitudeAction) return 'Set Attitude';
    if (isChapterTransition) return 'Chapter Transition';
    if (isExchangeRoutine) return 'Exchange Routine';
    if (isAction) return 'Action';
    return 'Unknown';
  };

  const getActionIcon = () => {
    if (isDialogLine) return <ChatIcon fontSize="small" />;
    if (isChoice) return <CallSplitIcon fontSize="small" />;
    if (isCreateTopic) return <LibraryBooksIcon fontSize="small" />;
    if (isLogEntry) return <DescriptionIcon fontSize="small" />;
    if (isLogSetTopicStatus) return <DescriptionIcon fontSize="small" />;
    if (isCreateInventoryItems) return <InventoryIcon fontSize="small" />;
    if (isGiveInventoryItems) return <CardGiftcardIcon fontSize="small" />;
    if (isAttackAction) return <GavelIcon fontSize="small" />;
    if (isSetAttitudeAction) return <EmojiPeopleIcon fontSize="small" />;
    if (isChapterTransition) return <NavigationIcon fontSize="small" />;
    if (isExchangeRoutine) return <SwapHorizIcon fontSize="small" />;
    if (isAction) return <CodeIcon fontSize="small" />;
    return <HelpOutlineIcon fontSize="small" />;
  };

  const actionTypes = useMemo(() => [
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
    // Note: Don't handle Enter/Space here - let MenuItem's onClick handle it naturally
    // to avoid double-triggering
  }, [actionTypes, selectedMenuIndex]);

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
      <Stack spacing={2}>
          {isDialogLine && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <FormControl size="small" sx={{ width: 150, flexShrink: 0 }}>
                <InputLabel>Speaker</InputLabel>
                <Select
                  value={localAction.speaker || 'self'}
                  label="Speaker"
                  onChange={(e) => handleUpdate({ ...localAction, speaker: e.target.value })}
                  onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
                >
                  <MenuItem value="self">{npcName}</MenuItem>
                  <MenuItem value="other">Hero</MenuItem>
                </Select>
              </FormControl>
              <TextField
                fullWidth
                label="Text"
                value={localAction.text || ''}
                onChange={(e) => handleUpdate({ ...localAction, text: e.target.value })}
                size="small"
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              {localAction.id && (
                <Tooltip title={`Dialog ID: ${localAction.id}`} arrow>
                  <IconButton size="small" sx={{ flexShrink: 0 }}>
                    <InfoIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isChoice && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Choice Text"
                value={localAction.text || ''}
                onChange={(e) => handleUpdate({ ...localAction, text: e.target.value })}
                size="small"
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
                sx={{ flex: '1 1 40%', minWidth: 150 }}
              />
              <TextField
                label="Function"
                value={localAction.targetFunction || ''}
                onChange={(e) => {
                  const newName = e.target.value;
                  handleUpdate({ ...localAction, targetFunction: newName });
                }}
                onBlur={() => {
                  flushUpdate();
                  // Validate and handle rename if needed
                  if (dialogContextName && onRenameFunction && localAction.targetFunction !== action.targetFunction) {
                    const validationError = validateChoiceFunctionName(
                      localAction.targetFunction,
                      dialogContextName,
                      semanticModel,
                      action.targetFunction
                    );

                    if (validationError) {
                      // Revert to original name on validation error
                      handleUpdate({ ...localAction, targetFunction: action.targetFunction });
                      alert(validationError);
                    } else if (localAction.targetFunction !== action.targetFunction) {
                      // Valid rename - trigger the rename callback
                      onRenameFunction(action.targetFunction, localAction.targetFunction);
                    }
                  }
                }}
                size="small"
                sx={{ flex: '1 1 40%', minWidth: 150 }}
                error={dialogContextName && localAction.targetFunction ? !localAction.targetFunction.startsWith(dialogContextName) : false}
              />
              {semanticModel && localAction.targetFunction && semanticModel.functions && semanticModel.functions[localAction.targetFunction] && onNavigateToFunction && (
                <Tooltip title="Edit choice actions" arrow>
                  <Badge
                    badgeContent={semanticModel.functions[localAction.targetFunction]?.actions?.length || 0}
                    color="secondary"
                    sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', height: '16px', minWidth: '16px' } }}
                  >
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => {
                        flushUpdate();
                        onNavigateToFunction(localAction.targetFunction);
                      }}
                      sx={{ flexShrink: 0 }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Badge>
                </Tooltip>
              )}
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isCreateTopic && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Topic"
                value={localAction.topic || ''}
                onChange={(e) => handleUpdate({ ...localAction, topic: e.target.value })}
                size="small"
                sx={{ minWidth: 180 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="Topic Type"
                value={localAction.topicType || ''}
                onChange={(e) => handleUpdate({ ...localAction, topicType: e.target.value })}
                size="small"
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isLogEntry && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Topic"
                value={localAction.topic || ''}
                onChange={(e) => handleUpdate({ ...localAction, topic: e.target.value })}
                size="small"
                sx={{ minWidth: 180 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="Text"
                value={localAction.text || ''}
                onChange={(e) => handleUpdate({ ...localAction, text: e.target.value })}
                size="small"
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isLogSetTopicStatus && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Topic"
                value={localAction.topic || ''}
                onChange={(e) => handleUpdate({ ...localAction, topic: e.target.value })}
                size="small"
                sx={{ minWidth: 180 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="Status"
                value={localAction.status || ''}
                onChange={(e) => handleUpdate({ ...localAction, status: e.target.value })}
                size="small"
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isCreateInventoryItems && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Target"
                value={localAction.target || ''}
                onChange={(e) => handleUpdate({ ...localAction, target: e.target.value })}
                size="small"
                sx={{ width: 100 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Item"
                value={localAction.item || ''}
                onChange={(e) => handleUpdate({ ...localAction, item: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Quantity"
                type="number"
                value={localAction.quantity || ''}
                onChange={(e) => handleUpdate({ ...localAction, quantity: parseInt(e.target.value) || 0 })}
                size="small"
                sx={{ width: 90 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isGiveInventoryItems && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Giver"
                value={localAction.giver || ''}
                onChange={(e) => handleUpdate({ ...localAction, giver: e.target.value })}
                size="small"
                sx={{ width: 80 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Receiver"
                value={localAction.receiver || ''}
                onChange={(e) => handleUpdate({ ...localAction, receiver: e.target.value })}
                size="small"
                sx={{ width: 90 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Item"
                value={localAction.item || ''}
                onChange={(e) => handleUpdate({ ...localAction, item: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Quantity"
                type="number"
                value={localAction.quantity || ''}
                onChange={(e) => handleUpdate({ ...localAction, quantity: parseInt(e.target.value) || 0 })}
                size="small"
                sx={{ width: 90 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isAttackAction && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Attacker"
                value={localAction.attacker || ''}
                onChange={(e) => handleUpdate({ ...localAction, attacker: e.target.value })}
                size="small"
                sx={{ width: 90 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Target"
                value={localAction.target || ''}
                onChange={(e) => handleUpdate({ ...localAction, target: e.target.value })}
                size="small"
                sx={{ width: 80 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Reason"
                value={localAction.attackReason || ''}
                onChange={(e) => handleUpdate({ ...localAction, attackReason: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                label="Damage"
                type="number"
                value={localAction.damage || ''}
                onChange={(e) => handleUpdate({ ...localAction, damage: parseInt(e.target.value) || 0 })}
                size="small"
                sx={{ width: 90 }}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isSetAttitudeAction && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Target"
                value={localAction.target || ''}
                onChange={(e) => handleUpdate({ ...localAction, target: e.target.value })}
                size="small"
                sx={{ width: 120 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="Attitude"
                value={localAction.attitude || ''}
                onChange={(e) => handleUpdate({ ...localAction, attitude: e.target.value })}
                size="small"
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isChapterTransition && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Chapter"
                type="number"
                value={localAction.chapter || ''}
                onChange={(e) => handleUpdate({ ...localAction, chapter: parseInt(e.target.value) || 0 })}
                size="small"
                sx={{ width: 100 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="World"
                value={localAction.world || ''}
                onChange={(e) => handleUpdate({ ...localAction, world: e.target.value })}
                size="small"
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isExchangeRoutine && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                label="Target NPC"
                value={localAction.target || localAction.npc || ''}
                onChange={(e) => {
                  const updated = { ...localAction, routine: localAction.routine };
                  if (localAction.target !== undefined) {
                    updated.target = e.target.value;
                    delete updated.npc;
                  } else {
                    updated.npc = e.target.value;
                    delete updated.target;
                  }
                  handleUpdate(updated);
                }}
                size="small"
                sx={{ width: 120 }}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <TextField
                fullWidth
                label="Routine"
                value={localAction.routine || ''}
                onChange={(e) => handleUpdate({ ...localAction, routine: e.target.value })}
                size="small"
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isAction && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Tooltip title={getActionTypeLabel()} arrow>
                <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0, mt: 0.5 }}>
                  {getActionIcon()}
                </Box>
              </Tooltip>
              <TextField
                fullWidth
                label="Action"
                value={localAction.action || ''}
                onChange={(e) => handleUpdate({ ...localAction, action: e.target.value })}
                size="small"
                multiline
                rows={2}
                inputRef={mainFieldRef}
                onBlur={flushUpdate}
                onKeyDown={handleKeyDown}
              />
              <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0, mt: 0.5 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          {isUnknown && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Tooltip title={getActionTypeLabel()} arrow>
                  <Box sx={{ display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
                    {getActionIcon()}
                  </Box>
                </Tooltip>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" color="warning.main" gutterBottom>
                    This action type is not recognized. Fields detected:
                  </Typography>
                  <TextField
                    fullWidth
                    label="Raw JSON"
                    value={JSON.stringify(localAction, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        handleUpdate(parsed);
                      } catch (err) {
                        // Invalid JSON, ignore
                      }
                    }}
                    size="small"
                    multiline
                    rows={6}
                    helperText="Edit the raw JSON structure"
                    sx={{ fontFamily: 'monospace' }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Properties: {Object.keys(localAction).join(', ')}
                  </Typography>
                </Box>
                <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          )}
      </Stack>

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
        <Box
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
        >
          <AddIcon fontSize="small" sx={{ color: 'primary.main' }} />
          {hasFocus && (
            <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
              Shift+Enter
            </Typography>
          )}
        </Box>
      </Box>

    </Box>
  );
}));

ActionCard.displayName = 'ActionCard';

export default ActionCard;
