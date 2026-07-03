import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, PlaylistAdd as PlaylistAddIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';
import type { ConditionalAction } from '../../types/global';
import type { ActionTypeId } from '../actionTypes';
import type { ActionBranchKey } from '../nestedActionUtils';
import ActionsList from '../ActionsList';
import ActionTypeMenu from '../common/ActionTypeMenu';

/**
 * Daedalus snippets for common If-block conditions (issue #145: parity with
 * the dialog-level condition editor, especially "knows info").
 */
const CONDITION_TEMPLATES: ReadonlyArray<{ label: string; snippet: string }> = [
  { label: 'NPC Knows Dialog', snippet: 'Npc_KnowsInfo(other, DIA_)' },
  { label: 'Variable Check', snippet: 'MyVariable == 1' },
  { label: 'NPC Has Items', snippet: 'Npc_HasItems(other, ItMi_Gold) >= 1' },
  { label: 'NPC Is In State', snippet: 'Npc_IsInState(self, ZS_Talk)' },
  { label: 'NPC Is Dead', snippet: 'Npc_IsDead(self)' },
  { label: 'Quest State', snippet: 'MIS_ == LOG_RUNNING' }
];

const ConditionalActionRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  path,
  npcName,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef,
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
  semanticModel,
  onNavigateToFunction,
  onRenameFunction,
  dialogContextName,
  droppableNamespace,
  filePath
}) => {
  const typedAction = action as ConditionalAction;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [templateMenuAnchor, setTemplateMenuAnchor] = useState<HTMLElement | null>(null);
  const [activeBranch, setActiveBranch] = useState<ActionBranchKey>('then');

  const insertConditionTemplate = (snippet: string) => {
    const existing = (typedAction.condition || '').trim();
    const condition = existing ? `${existing} && ${snippet}` : snippet;
    handleUpdate({ ...typedAction, condition });
    setTemplateMenuAnchor(null);
  };

  const branchSections = useMemo(() => ([
    { branch: 'then' as const, label: 'If' },
    { branch: 'else' as const, label: 'Else' }
  ]), []);

  const openBranchMenu = (event: React.MouseEvent<HTMLElement>, branch: ActionBranchKey) => {
    setActiveBranch(branch);
    setMenuAnchor(event.currentTarget);
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'background.default' }}>
      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <TextField
            fullWidth
            label="Condition"
            value={typedAction.condition || ''}
            onChange={(event) => handleUpdate({ ...typedAction, condition: event.target.value })}
            onBlur={flushUpdate}
            onKeyDown={handleKeyDown}
            size="small"
            inputRef={mainFieldRef}
          />
          <Tooltip title="Insert condition template">
            <IconButton
              size="small"
              onClick={(event) => setTemplateMenuAnchor(event.currentTarget)}
              aria-label="Insert condition template"
            >
              <PlaylistAddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete block">
            <IconButton size="small" color="error" onClick={handleDelete} aria-label="Delete conditional block">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Menu
          anchorEl={templateMenuAnchor}
          open={Boolean(templateMenuAnchor)}
          onClose={() => setTemplateMenuAnchor(null)}
        >
          {CONDITION_TEMPLATES.map(({ label, snippet }) => (
            <MenuItem key={label} onClick={() => insertConditionTemplate(snippet)}>
              {label}
            </MenuItem>
          ))}
        </Menu>

        {branchSections.map(({ branch, label }) => {
          const branchActions = branch === 'then' ? typedAction.thenActions : typedAction.elseActions;
          return (
            <Box key={branch}>
              <Divider sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {label}
                </Typography>
              </Divider>

              <ActionsList
                actions={branchActions}
                pathPrefix={[...path, branch]}
                npcName={npcName}
                updateActionAtPath={updateActionAtPath!}
                deleteActionAtPath={deleteActionAtPath!}
                focusActionAtPath={focusActionAtPath!}
                addDialogLineAfterPath={addDialogLineAfterPath!}
                deleteActionAndFocusPrevAtPath={deleteActionAndFocusPrevAtPath!}
                addActionAfterPath={addActionAfterPath!}
                addActionToBranchEnd={addActionToBranchEnd}
                moveAction={moveAction}
                registerActionRef={registerActionRef!}
                getVisibleActionPaths={getVisibleActionPaths!}
                semanticModel={semanticModel}
                onNavigateToFunction={onNavigateToFunction}
                onRenameFunction={onRenameFunction}
                dialogContextName={dialogContextName || ''}
                droppableNamespace={droppableNamespace}
                contextId={`${dialogContextName || 'dialog'}:${path.join('.')}:${branch}`}
                filePath={filePath}
              />

              {branchActions.length === 0 && (
                <Box
                  sx={{
                    border: '1px dashed',
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    No actions in this branch.
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={() => addActionToBranchEnd?.(path, branch, 'dialogLine')}
                    >
                      Add Line
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={(event) => openBranchMenu(event, branch)}
                    >
                      Add Action
                    </Button>
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}
      </Stack>

      <ActionTypeMenu
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        onSelect={(actionType: ActionTypeId) => {
          addActionToBranchEnd?.(path, activeBranch, actionType);
        }}
      />
    </Paper>
  );
};

export default ConditionalActionRenderer;
