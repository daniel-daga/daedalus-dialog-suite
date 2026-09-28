import React, { useCallback, useMemo, useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { Code as CodeIcon, MenuBook as MenuBookIcon } from '@mui/icons-material';
import type { BaseActionRendererProps } from './types';
import type { QuestStepAction } from '../actionTypes';
import { ActionTextField, ActionDeleteButton } from '../common';
import VariableAutocomplete from '../common/VariableAutocomplete';
import { AUTOCOMPLETE_POLICIES } from '../common/autocompletePolicies';
import { createRowTabHandlers } from './rowTabNavigation';
import { normalizeTopicName } from './LogEntryRenderer';
import { useProjectStore } from '../../store/projectStore';
import RegisterTopicDialog from '../RegisterTopicDialog';

const KIND_LABEL: Record<QuestStepAction['kind'], string> = {
  start: 'Start quest',
  complete: 'Complete quest',
  fail: 'Fail quest',
  cancel: 'Cancel quest',
  note: 'Note'
};

// Hoisted so VariableAutocomplete's memo sees a stable sx identity (slice 4).
const QUEST_FIELD_SX = { flex: 1, minWidth: 180 };

/**
 * A quest step card (#322): one card for the vanilla lines that start, log,
 * end or note a quest. Edits go back to those lines through ActionsList.
 */
const QuestStepRenderer: React.FC<BaseActionRendererProps> = ({
  action,
  handleUpdate,
  handleDelete,
  flushUpdate,
  handleKeyDown,
  mainFieldRef
}) => {
  const step = action as unknown as QuestStepAction;
  const [showScript, setShowScript] = useState(false);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const isProjectMode = useProjectStore((s) => !!s.projectPath);
  // Until declarations are automatic (#322), a start or note registers its
  // topic in the log files the way the Create Topic card does (#114).
  const canRegister = isProjectMode && (step.kind === 'start' || step.kind === 'note');
  const registerLabel = step.kind === 'note' ? 'Register note in log files' : 'Register quest in log files';
  const update = useCallback(
    (patch: Partial<QuestStepAction>) => handleUpdate({ ...step, ...patch } as unknown as typeof action),
    [handleUpdate, step]
  );

  // The diary shows a quest by its title, so name it (as LogEntryRenderer does).
  const title = useProjectStore((s) => {
    const value = step.topic ? s.mergedSemanticModel?.constants?.[step.topic]?.value : undefined;
    return typeof value === 'string' ? value.replace(/^"(.*)"$/s, '$1') : undefined;
  });
  const questFieldProps = useMemo(
    () => (title ? { helperText: `"${title}" in the diary` } : undefined),
    [title]
  );
  const handleTopicChange = useCallback(
    (value: string) => update({ topic: normalizeTopicName(value) }),
    [update]
  );

  const hasXp = step.kind === 'complete';
  const fieldKeyDown = useMemo(
    () => createRowTabHandlers(handleKeyDown, hasXp ? 3 : 2),
    [handleKeyDown, hasXp]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="quest-step-card">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ minWidth: 110, pt: 1 }}>
          {KIND_LABEL[step.kind]}
        </Typography>
        <VariableAutocomplete
          label={step.kind === 'note' ? 'Note topic' : 'Quest'}
          value={step.topic}
          onChange={handleTopicChange}
          onFlush={flushUpdate}
          onKeyDown={fieldKeyDown[0]}
          isMainField
          mainFieldRef={mainFieldRef}
          sx={QUEST_FIELD_SX}
          textFieldProps={questFieldProps}
          {...AUTOCOMPLETE_POLICIES.actions.topic}
        />
        {hasXp && (
          <ActionTextField
            label="XP (optional)"
            placeholder="XP_… or a number"
            value={step.xp}
            onChange={(value) => update({ xp: value.trim() })}
            onFlush={flushUpdate}
            onKeyDown={fieldKeyDown[1]}
            sx={{ width: 170 }}
          />
        )}
        {canRegister && (
          <Tooltip title={registerLabel}>
            <span>
              <IconButton
                size="small"
                aria-label={registerLabel}
                tabIndex={-1}
                disabled={!step.topic || step.topic === 'TOPIC_'}
                onClick={() => setIsRegisterOpen(true)}
              >
                <MenuBookIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={showScript ? 'Hide script' : 'Show script'}>
          <IconButton
            size="small"
            aria-label={showScript ? 'Hide script' : 'Show script'}
            aria-pressed={showScript}
            onClick={() => setShowScript((shown) => !shown)}
          >
            <CodeIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <ActionDeleteButton onClick={handleDelete} />
      </Box>
      <ActionTextField
        fullWidth
        label={step.kind === 'note' ? 'Note text' : 'Diary entry'}
        placeholder={step.kind === 'start' || step.kind === 'note' ? '' : 'Optional'}
        value={step.text}
        onChange={(value) => update({ text: value })}
        onFlush={flushUpdate}
        onKeyDown={fieldKeyDown[hasXp ? 2 : 1]}
        multiline
        minRows={1}
      />
      {canRegister && isRegisterOpen && (
        <RegisterTopicDialog
          open={isRegisterOpen}
          onClose={() => setIsRegisterOpen(false)}
          topicName={step.topic}
          topicType={step.kind === 'note' ? 'LOG_NOTE' : 'LOG_MISSION'}
        />
      )}
      {showScript && (
        <Box
          component="pre"
          data-testid="quest-step-script"
          sx={{ m: 0, p: 1, fontFamily: 'monospace', fontSize: '0.8rem', bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap' }}
        >
          {step.script}
        </Box>
      )}
    </Box>
  );
};

export default QuestStepRenderer;
