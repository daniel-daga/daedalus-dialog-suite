import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';
import type { ConditionalAction } from '../../types/global';
import type { ActionTypeId } from '../actionTypes';
import type { ActionBranchKey } from '../nestedActionUtils';
import ActionsList from '../ActionsList';
import ActionTypeMenu from '../common/ActionTypeMenu';

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
  filePath
}) => {
  const typedAction = action as ConditionalAction;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [activeBranch, setActiveBranch] = useState<ActionBranchKey>('then');

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
          <Tooltip title="Delete block">
            <IconButton size="small" color="error" onClick={handleDelete} aria-label="Delete conditional block">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

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
