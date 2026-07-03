import React from 'react';
import { Box, Collapse, TextField, IconButton, Tooltip, Badge } from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { validateChoiceFunctionName } from '../dialogUtils';
import InlineChoiceEditor from '../InlineChoiceEditor';
import { useResolvedFunction } from '../hooks/useResolvedFunction';
import { useFileStore } from '../../store/fileStore';
import { useProjectStore } from '../../store/projectStore';
import type { BaseActionRendererProps } from './types';
import type { ChoiceAction } from '../../types/global';

const ChoiceRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
  onNavigateToFunction,
  onRenameFunction,
  dialogContextName,
  filePath,
  npcName,
}) => {
  const typedAction = action as ChoiceAction;
  const originalFunctionNameRef = React.useRef<string | null>(null);
  const [localTargetFunction, setLocalTargetFunction] = React.useState(typedAction.targetFunction || '');
  const [expanded, setExpanded] = React.useState(false);
  const [focusInnerNonce, setFocusInnerNonce] = React.useState(0);
  const [functionNameError, setFunctionNameError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLocalTargetFunction(typedAction.targetFunction || '');
  }, [typedAction.targetFunction]);

  // Resolve the choice's target function from the store (fix-07 §2.8): a narrow
  // subscription that re-renders this leaf only when that one function changes,
  // so model data no longer has to be threaded through the ActionCard memo.
  const targetFunction = useResolvedFunction(typedAction.targetFunction, filePath);
  const targetFunctionExists = !!(typedAction.targetFunction && targetFunction);

  // Mouse toggling the sub-editor must never steal focus into it (issue #118).
  const handleToggleExpand = () => {
    setExpanded((prev) => !prev);
    setFocusInnerNonce(0);
  };

  // Forward Tab on the Choice Text field dives into the choice's sub-dialog
  // (issue #118) instead of skipping to the next action card. Everything else —
  // Shift+Tab, Enter, Escape, and Tab when there is no sub-dialog yet — falls
  // back to the card-level handler.
  const handleChoiceTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && !e.shiftKey && targetFunctionExists) {
      e.preventDefault();
      flushUpdate();
      setExpanded(true);
      setFocusInnerNonce((n) => n + 1);
      return;
    }
    handleKeyDown(e);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* Expand/collapse toggle */}
        {targetFunctionExists && (
          <Tooltip title={expanded ? 'Collapse choice actions' : 'Expand choice actions'} arrow>
            <IconButton
              size="small"
              onClick={handleToggleExpand}
              aria-label={expanded ? 'Collapse choice actions' : 'Expand choice actions'}
              sx={{ flexShrink: 0 }}
            >
              {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
        <TextField
          label="Choice Text"
          value={typedAction.text || ''}
          onChange={(e) => handleUpdate({ ...typedAction, text: e.target.value })}
          size="small"
          inputRef={mainFieldRef}
          onBlur={flushUpdate}
          onKeyDown={handleChoiceTextKeyDown}
          sx={{ flex: '1 1 40%', minWidth: 150 }}
        />
        <TextField
          label="Function"
          value={localTargetFunction}
          onFocus={() => {
            originalFunctionNameRef.current = localTargetFunction || null;
            setFunctionNameError(null);
          }}
          onChange={(e) => {
            const newName = e.target.value;
            setLocalTargetFunction(newName);
            setFunctionNameError(null);
            handleUpdate({ ...typedAction, targetFunction: newName });
          }}
          onBlur={() => {
            flushUpdate();
            const originalName = originalFunctionNameRef.current;
            const newName = localTargetFunction;
            if (dialogContextName && onRenameFunction && originalName && newName !== originalName) {
              // Read the model imperatively at validation time (event handler,
              // not render) so ChoiceRenderer never subscribes to the whole
              // model. File-first mirrors the editor's own resolution order.
              const fileModel = filePath
                ? useFileStore.getState().openFiles.get(filePath)?.semanticModel
                : undefined;
              const validationModel = fileModel ?? useProjectStore.getState().mergedSemanticModel;
              const validationError = validateChoiceFunctionName(
                newName, dialogContextName, validationModel, originalName
              );
              if (validationError) {
                setLocalTargetFunction(originalName);
                handleUpdate({ ...typedAction, targetFunction: originalName });
                setFunctionNameError(validationError);
              } else {
                setFunctionNameError(null);
                onRenameFunction(originalName, newName);
              }
            }
            originalFunctionNameRef.current = null;
          }}
          size="small"
          sx={{ flex: '1 1 40%', minWidth: 150 }}
          error={!!functionNameError || (dialogContextName && localTargetFunction ? !localTargetFunction.startsWith(dialogContextName) : false)}
          helperText={functionNameError}
        />
        {targetFunctionExists && onNavigateToFunction && (
          <Tooltip title="Edit choice actions (navigate)" arrow>
            <Badge
              badgeContent={targetFunction?.actions?.length || 0}
              color="secondary"
              sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', height: '16px', minWidth: '16px' } }}
            >
              <IconButton
                size="small"
                color="primary"
                onClick={() => {
                  flushUpdate();
                  onNavigateToFunction(typedAction.targetFunction);
                }}
                sx={{ flexShrink: 0 }}
                aria-label="Edit choice actions"
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Badge>
          </Tooltip>
        )}
        <Tooltip title="Delete choice">
          <IconButton size="small" color="error" onClick={handleDelete} sx={{ flexShrink: 0 }} aria-label="Delete choice">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Inline expanded choice editor */}
      <Collapse in={expanded} unmountOnExit>
        <InlineChoiceEditor
          targetFunctionName={typedAction.targetFunction}
          dialogName={dialogContextName || ''}
          filePath={filePath || null}
          npcName={npcName || ''}
          focusFirstActionNonce={focusInnerNonce}
        />
      </Collapse>
    </Box>
  );
};

export default ChoiceRenderer;
